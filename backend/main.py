"""FastAPI backend for DNS Editor.

The API receives zone data from the web UI, writes BIND zone files, validates
them with named-checkzone, registers zones in named.conf.local, and calls rndc
for reload/reconfig operations. DNSSEC helpers manage inline-signing settings
and DS record discovery.
"""
import os
import re
import shutil
import subprocess
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

import dns.rdatatype
import dns.zone
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel


ZONES_DIR = Path(os.getenv("ZONES_DIR", "/etc/bind/zones"))
KEYS_DIR = ZONES_DIR / "keys"
BIND_DIR = Path(os.getenv("BIND_DIR", "/etc/bind"))
NAMED_CONF_LOCAL = BIND_DIR / "named.conf.local"
RNDC_KEY_PATH = Path(os.getenv("RNDC_KEY_PATH", str(BIND_DIR / "rndc.key")))
BIND_HOST = os.getenv("BIND_HOST", "127.0.0.1")

ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-to-a-random-secret-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))


pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_hashed_admin_pw = pwd_ctx.hash(ADMIN_PASSWORD)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def _create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")



app = FastAPI(title="DNS Zones API")

_cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



class ZoneRecord(BaseModel):
    name: str
    type: Literal["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SRV"]
    value: str
    ttl: int
    priority: Optional[int] = None


class ZoneData(BaseModel):
    name: str
    type: Literal["master", "slave"] = "master"
    ttl: int
    adminEmail: str
    primaryNs: str
    records: list[ZoneRecord]


class DnssecStatus(BaseModel):
    enabled: bool
    ds_records: list[str] = []
    dnskey_present: bool = False
    message: Optional[str] = None



@app.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends()):
    if form.username != ADMIN_USER or not pwd_ctx.verify(form.password, _hashed_admin_pw):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный логин или пароль")
    return {"access_token": _create_token(form.username), "token_type": "bearer"}


@app.get("/")
def root():
    return {"status": "ok", "message": "DNS backend is running"}



@app.get("/status")
def bind_status(_user: str = Depends(get_current_user)):
    try:
        result = _run_rndc("status")
        if result.returncode != 0:
            return {"bind_running": False, "error": result.stderr or result.stdout or "rndc failed"}
        output = result.stdout
        version = ""
        uptime = ""
        for line in output.splitlines():
            if line.startswith("version:"):
                version = line.split(":", 1)[1].strip()
            if "server is up and running" in line:
                uptime = line.strip()
        zones_count = 0
        for line in output.splitlines():
            if "zones" in line and ("master" in line or "primary" in line):
                match = re.search(r"(\d+)", line)
                if match:
                    zones_count = int(match.group(1))
                    break
        return {"bind_running": True, "version": version, "uptime": uptime, "zones_count": zones_count}
    except FileNotFoundError:
        return {"bind_running": False, "error": "rndc not found"}
    except subprocess.TimeoutExpired:
        return {"bind_running": False, "error": "rndc timeout"}
    except Exception as exc:
        return {"bind_running": False, "error": str(exc)}



def _zone_file_path(zone_name: str) -> Path:
    return ZONES_DIR / f"db.{zone_name}"


def _absolute_domain(name: str) -> str:
    """FQDN для RDATA в zone-файле BIND.

    Имя без точки в конце в записях NS/CNAME/MX/SRV считается относительным к origin зоны,
    поэтому ns1.example.com превращается в ns1.example.com.example.com — ошибка glue/NS.
    """
    s = (name or "").strip()
    if not s:
        return s
    return s.rstrip(".") + "."


def _is_safe_zone_path_component(zone_name: str) -> bool:
    """Защита от path traversal и лишних файлов (имя зоны = часть пути db.<name>)."""
    if not zone_name or len(zone_name) > 253:
        return False
    if any(c in zone_name for c in "/\\\0"):
        return False
    if ".." in zone_name or zone_name.startswith(".") or zone_name.endswith("."):
        return False
    return True


def _has_injection_chars(s: str) -> bool:
    """Символы, через которые можно сломать синтаксис zone-файла или внедрить запись."""
    if not s:
        return False
    return bool(re.search(r"[\n\r\x00;()$]", s))


def _label_ok(label: str) -> bool:
    if not label or len(label) > 63:
        return False
    if label == "*":
        return True
    return bool(re.match(r"^[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?$", label))


def _validate_owner_name(name: str) -> Optional[str]:
    """Относительное имя владельца записи (@, www, ns1, *.demo нельзя тут полностью — только метки)."""
    n = (name or "").strip()
    if not n:
        return "Пустое имя записи (укажите @ для корня зоны)."
    if n == "@":
        return None
    parts = n.split(".")
    for p in parts:
        if not _label_ok(p):
            return f"Недопустимое имя записи «{n}»: проверьте метки (ASCII, дефис не с краёв, длина ≤63)."
    return None


def _validate_domain_labels(hostname: str, ctx: str) -> Optional[str]:
    s = (hostname or "").strip().rstrip(".")
    if not s:
        return f"Пустое имя в {ctx}."
    if _has_injection_chars(s):
        return f"Недопустимые символы в {ctx}."
    parts = s.split(".")
    if len(parts) < 2:
        return f"Ожидается доменное имя (минимум одна точка) в {ctx}: «{s}»."
    for p in parts:
        if not _label_ok(p) or p == "*":
            return f"Некорректная метка в {ctx}: «{s}»."
    return None


def _txt_bind_rdatatext(user_text: str) -> str:
    """BIND TXT: одна или несколько строк в кавычках по 255 октетов на строку (RFC 1035)."""
    inner = user_text.replace("\\", "\\\\").replace('"', '\\"')
    if len(inner) <= 255:
        return f'"{inner}"'
    parts = [f'"{inner[i : i + 255]}"' for i in range(0, len(inner), 255)]
    return " ".join(parts)


def _is_valid_ipv4(addr: str) -> bool:
    parts = addr.split(".")
    if len(parts) != 4:
        return False
    return all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def _validate_zone_data(data: ZoneData) -> list[str]:
    errors: list[str] = []
    if data.ttl < 60:
        errors.append("TTL зоны должен быть не меньше 60.")

    if _has_injection_chars(data.primaryNs) or _has_injection_chars(data.adminEmail):
        errors.append("Primary NS или email содержат недопустимые символы (перенос строки, ;, $ и т.д.).")

    pem = _validate_domain_labels(data.primaryNs, "Primary NS")
    if pem:
        errors.append(pem)

    if "@" not in (data.adminEmail or ""):
        errors.append("Email администратора должен содержать символ @.")
    else:
        local, _, domain = data.adminEmail.partition("@")
        if not local or not domain or _has_injection_chars(local) or _has_injection_chars(domain):
            errors.append("Некорректный email администратора.")
        else:
            dom_err = _validate_domain_labels(domain, "домен в email администратора")
            if dom_err:
                errors.append(dom_err)

    ns_count = sum(1 for r in data.records if r.type == "NS")
    if ns_count < 1:
        errors.append("Нужна минимум одна NS-запись.")

    by_owner: dict[str, list[ZoneRecord]] = defaultdict(list)
    for r in data.records:
        owner = (r.name or "").strip()
        key = owner if owner else "@"
        by_owner[key].append(r)

    for owner, recs in by_owner.items():
        cnames = [x for x in recs if x.type == "CNAME"]
        if len(cnames) > 1:
            errors.append(f"Имя «{owner}»: разрешена только одна CNAME-запись.")
        if cnames:
            others = [x for x in recs if x.type != "CNAME"]
            if others:
                types = ", ".join(sorted({x.type for x in others}))
                errors.append(f"Имя «{owner}»: CNAME нельзя сочетать с другими записями ({types}).")

    for r in data.records:
        on = _validate_owner_name(r.name)
        if on:
            errors.append(on)
        if r.ttl < 60:
            errors.append(f"TTL записи {r.name or r.type} должен быть не меньше 60.")

        if r.type in ("NS", "CNAME"):
            err = _validate_domain_labels(r.value, f"{r.type} у {r.name}")
            if err:
                errors.append(err)
        if r.type == "MX":
            pr = r.priority if r.priority is not None else 10
            if pr < 0 or pr > 65535:
                errors.append(f"MX приоритет у {r.name} должен быть 0..65535.")
            err = _validate_domain_labels(r.value, f"MX у {r.name}")
            if err:
                errors.append(err)
        if r.type == "SRV":
            pr = r.priority if r.priority is not None else 10
            if pr < 0 or pr > 65535:
                errors.append(f"SRV приоритет у {r.name} должен быть 0..65535.")
            parts = (r.value or "").strip().split()
            if len(parts) >= 3:
                try:
                    w, port = int(parts[0]), int(parts[1])
                    if w < 0 or w > 65535:
                        errors.append(f"SRV weight у {r.name} должен быть 0..65535.")
                    if port < 0 or port > 65535:
                        errors.append(f"SRV порт у {r.name} должен быть 0..65535.")
                except ValueError:
                    errors.append(f"SRV у {r.name}: weight и порт должны быть числами.")
                tgt = " ".join(parts[2:])
                terr = _validate_domain_labels(tgt, f"SRV target у {r.name}")
                if terr:
                    errors.append(terr)
            else:
                errors.append(f"SRV у {r.name}: укажите значение как «вес порт имя-хоста» (три части).")

        if r.type == "TXT":
            if r.value is None or not str(r.value).strip() or "\x00" in r.value:
                errors.append(f"TXT у {r.name}: пустое или недопустимое значение.")
            elif "\n" in r.value or "\r" in r.value:
                errors.append(f"TXT у {r.name}: нельзя использовать перевод строки (разбейте на несколько TXT вручную при необходимости).")
        if r.type == "A" and r.value.strip():
            if not _is_valid_ipv4(r.value.strip()):
                errors.append(f"Некорректный IPv4 в записи {r.name}: {r.value}")
        if r.type == "AAAA" and r.value.strip():
            import ipaddress
            try:
                ipaddress.IPv6Address(r.value.strip())
            except ValueError:
                errors.append(f"Некорректный IPv6 в записи {r.name}: {r.value}")
        if r.type != "SRV" and r.type != "TXT" and not (r.value or "").strip():
            errors.append(f"Пустое значение у записи {r.name} (тип {r.type}).")
        if r.type != "TXT" and (r.value and _has_injection_chars(r.value)):
            errors.append(f"Значение записи {r.name} ({r.type}) содержит недопустимые символы для zone-файла.")
    return errors


def _get_next_serial(zone_file: Path, zone_name: str) -> int:
    if not zone_file.exists():
        return 1
    try:
        z = dns.zone.from_file(str(zone_file), origin=zone_name, relativize=False)
        for (_, node) in z.nodes.items():
            for rdataset in node.rdatasets:
                if dns.rdatatype.to_text(rdataset.rdtype) == "SOA":
                    soa = rdataset[0]
                    serial = int(soa.serial)
                    return serial + 1
    except Exception:
        pass
    return int(datetime.now().strftime("%Y%m%d") + "01")


def _is_zone_registered(zone_name: str) -> bool:
    if not NAMED_CONF_LOCAL.exists():
        return False
    content = NAMED_CONF_LOCAL.read_text(encoding="utf-8")
    pattern = rf'zone\s+"{re.escape(zone_name)}"'
    return bool(re.search(pattern, content))


def _zone_block_pattern(zone_name: str) -> str:
    z = re.escape(zone_name)
    return r'zone\s+"' + z + r'"\s*\{(?:[^{}]|\{[^{}]*\})*\};\s*'


def _format_zone_block(zone_name: str, *, dnssec: bool) -> str:
    lines = [
        f'zone "{zone_name}" {{',
        "    type master;",
        f'    file "/etc/bind/zones/db.{zone_name}";',
    ]
    if dnssec:
        lines.extend(
            [
                f'    key-directory "/etc/bind/zones/keys/{zone_name}";',
                "    inline-signing yes;",
                "    dnssec-policy default;",
            ]
        )
    lines.extend(["    allow-update { none; };", "};"])
    return "\n".join(lines)


def _read_zone_block(zone_name: str) -> Optional[str]:
    if not NAMED_CONF_LOCAL.exists():
        return None
    content = NAMED_CONF_LOCAL.read_text(encoding="utf-8")
    match = re.search(_zone_block_pattern(zone_name), content, flags=re.DOTALL)
    return match.group(0) if match else None


def _is_dnssec_enabled(zone_name: str) -> bool:
    block = _read_zone_block(zone_name)
    if not block:
        return False
    return "inline-signing yes" in block or "dnssec-policy" in block


def _set_zone_dnssec(zone_name: str, enabled: bool) -> None:
    new_block = _format_zone_block(zone_name, dnssec=enabled)
    content = NAMED_CONF_LOCAL.read_text(encoding="utf-8") if NAMED_CONF_LOCAL.exists() else ""
    pattern = _zone_block_pattern(zone_name)
    if re.search(pattern, content, flags=re.DOTALL):
        content = re.sub(pattern, new_block + "\n", content, flags=re.DOTALL)
    else:
        content = content.rstrip() + "\n\n" + new_block + "\n"
    NAMED_CONF_LOCAL.write_text(content.strip() + "\n", encoding="utf-8")


def _zone_keys_dir(zone_name: str) -> Path:
    return KEYS_DIR / zone_name


def _ensure_keys_dir_writable(zone_name: str) -> Path:
    """BIND (uid 100 / gid 101 в образе ubuntu/bind9) пишет ключи в key-directory."""
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    keys_path = _zone_keys_dir(zone_name)
    keys_path.mkdir(parents=True, exist_ok=True)
    bind_uid, bind_gid = 100, 101
    for path in (KEYS_DIR, keys_path):
        try:
            os.chown(path, bind_uid, bind_gid)
            os.chmod(path, 0o775)
        except OSError:
            try:
                os.chmod(path, 0o777)
            except OSError:
                pass
    return keys_path


def _remove_zone_keys(zone_name: str) -> None:
    keys_path = _zone_keys_dir(zone_name)
    if keys_path.exists():
        shutil.rmtree(keys_path)


def _dig_short(qname: str, rrtype: str) -> list[str]:
    try:
        result = subprocess.run(
            ["dig", f"@{BIND_HOST}", qname, rrtype, "+dnssec", "+short"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError:
        return []
    except subprocess.TimeoutExpired:
        return []
    if result.returncode != 0:
        return []
    lines = [ln.strip() for ln in (result.stdout or "").splitlines() if ln.strip()]
    return lines


def _is_ksk_key_file(key_file: Path) -> bool:
    """KSK в .key-файле: «IN DNSKEY 257 …» (в имени файла — алгоритм, напр. +013+)."""
    try:
        text = key_file.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return bool(re.search(r"\bIN\s+DNSKEY\s+257\b", text, re.IGNORECASE))


def _ds_from_key_file(key_file: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["dnssec-dsfromkey", "-2", str(key_file)],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    lines: list[str] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line:
            lines.append(line)
    return lines


def _fetch_ds_records(zone_name: str) -> list[str]:
    ds = _dig_short(zone_name, "DS")
    if ds:
        return ds

    keys_path = _zone_keys_dir(zone_name)
    if not keys_path.is_dir():
        return []

    key_files = sorted(keys_path.glob("K*.key"))
    ksk_files = [kf for kf in key_files if _is_ksk_key_file(kf)]
    for key_file in ksk_files or key_files:
        for line in _ds_from_key_file(key_file):
            if line not in ds:
                ds.append(line)
    return ds


def _dnssec_sign_zone(zone_name: str) -> Optional[str]:
    for cmd in (("loadkeys", zone_name), ("sign", zone_name)):
        result = _run_rndc(*cmd)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            if err:
                return err
    return None


def _fetch_ds_records_with_retry(zone_name: str, attempts: int = 5, delay_sec: float = 1.0) -> list[str]:
    """После reconfig/reload ключи BIND могут появиться с задержкой."""
    ds: list[str] = []
    for attempt in range(attempts):
        ds = _fetch_ds_records(zone_name)
        if ds:
            return ds
        if attempt < attempts - 1:
            time.sleep(delay_sec)
    return ds


def _register_zone(zone_name: str) -> None:
    block = _format_zone_block(zone_name, dnssec=False)
    with NAMED_CONF_LOCAL.open("a", encoding="utf-8") as f:
        f.write("\n" + block + "\n")


def _run_rndc(*args: str) -> subprocess.CompletedProcess:
    cmd = ["rndc"]
    if BIND_HOST and BIND_HOST not in ("localhost", "127.0.0.1", "::1"):
        cmd += ["-s", BIND_HOST]
    if RNDC_KEY_PATH.exists():
        cmd += ["-k", str(RNDC_KEY_PATH)]
    cmd += list(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=10)


def _check_zone(zone_name: str, zone_file: Path) -> tuple[bool, str]:
    """Проверка зоны через named-checkzone; возвращает (ok, output)."""
    try:
        result = subprocess.run(
            ["named-checkzone", zone_name, str(zone_file)],
            capture_output=True, text=True, timeout=10,
        )
        output = (result.stdout + "\n" + result.stderr).strip()
        return result.returncode == 0, output
    except FileNotFoundError:
        return True, "named-checkzone not available, skipped"
    except subprocess.TimeoutExpired:
        return False, "named-checkzone timeout"


def _is_editable_zone_file(path: Path) -> bool:
    """Return True only for source zone files that should appear in the UI."""
    name = path.name
    if not path.is_file() or not name.startswith("db."):
        return False
    ignored_suffixes = (
        ".bak",
        ".jnl",
        ".jbk",
        ".signed",
        ".signed.jnl",
        ".signed.jbk",
    )
    return not name.endswith(ignored_suffixes)



@app.get("/zones")
def list_zones(_user: str = Depends(get_current_user)):
    if not ZONES_DIR.exists():
        raise HTTPException(status_code=500, detail=f"Zones directory not found: {ZONES_DIR}")
    files = sorted(p.name for p in ZONES_DIR.glob("db.*") if _is_editable_zone_file(p))
    return {"zones": files}


@app.get("/zones/{zone_name:path}/records", response_model=ZoneData)
def get_zone_records(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    zone_file = _zone_file_path(zone_name)
    if not zone_file.exists():
        raise HTTPException(status_code=404, detail=f"Zone file not found: {zone_file}")

    try:
        z = dns.zone.from_file(str(zone_file), origin=zone_name, relativize=False)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse zone: {exc}") from exc

    records: list[ZoneRecord] = []
    ttl_default = 3600
    admin_email = f"admin@{zone_name}"
    primary_ns = f"ns1.{zone_name}"

    for (name, node) in z.nodes.items():
        for rdataset in node.rdatasets:
            rtype = dns.rdatatype.to_text(rdataset.rdtype)
            ttl = rdataset.ttl or ttl_default

            fqdn = str(name).rstrip(".")
            zone_fqdn = f"{zone_name}.".rstrip(".")

            if fqdn == zone_fqdn or fqdn.endswith(f".{zone_fqdn}"):
                if fqdn == zone_fqdn:
                    record_name = "@"
                else:
                    short = fqdn[: -len(f".{zone_fqdn}")]
                    record_name = "@" if short in ("", "@") else short
            else:
                record_name = fqdn

            if rtype == "SOA":
                soa = rdataset[0]
                primary_ns = str(soa.mname).rstrip(".")
                email_fqdn = str(soa.rname).rstrip(".")
                admin_email = email_fqdn.replace(".", "@", 1)
                ttl_default = ttl
                continue

            for rdata in rdataset:
                value = ""
                priority: Optional[int] = None

                if rtype in ("A", "AAAA"):
                    value = rdata.address
                elif rtype in ("CNAME", "NS"):
                    value = str(rdata.target).rstrip(".")
                elif rtype == "MX":
                    priority = int(rdata.preference)
                    value = str(rdata.exchange).rstrip(".")
                elif rtype == "TXT":
                    value = "".join(
                        [part.decode() if isinstance(part, bytes) else str(part) for part in rdata.strings]
                    )
                elif rtype == "SRV":
                    priority = int(rdata.priority)
                    value = f"{rdata.weight} {rdata.port} {str(rdata.target).rstrip('.')}"
                else:
                    continue

                records.append(
                    ZoneRecord(
                        name=record_name or "@",
                        type=rtype,
                        value=value,
                        ttl=ttl,
                        priority=priority,
                    )
                )

    return ZoneData(
        name=zone_name,
        type="master",
        ttl=ttl_default,
        adminEmail=admin_email,
        primaryNs=primary_ns,
        records=records,
    )


@app.put("/zones/{zone_name:path}/records", response_model=ZoneData)
def update_zone_records(zone_name: str, data: ZoneData, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    data.name = zone_name
    validation_errors = _validate_zone_data(data)
    if validation_errors:
        raise HTTPException(status_code=400, detail=validation_errors)
    zone_file = _zone_file_path(zone_name)

    is_new_zone = not zone_file.exists()
    backup_path = zone_file.with_suffix(zone_file.suffix + ".bak")

    if zone_file.exists():
        backup_path.write_text(zone_file.read_text(encoding="utf-8"), encoding="utf-8")

    serial = _get_next_serial(zone_file, zone_name)
    lines: list[str] = []

    lines.append(f"$TTL {data.ttl}")
    soa_admin = _absolute_domain(data.adminEmail.replace("@", "."))
    lines.append(
        f"{data.name}. IN SOA {_absolute_domain(data.primaryNs)} {soa_admin}"
        " ("
    )
    lines.append(f"  {serial} ; serial")
    lines.append("  3600 ; refresh")
    lines.append("  900 ; retry")
    lines.append("  604800 ; expire")
    lines.append("  86400 ) ; minimum")
    lines.append("")

    for rec in data.records:
        if rec.type in ("MX", "SRV"):
            priority = rec.priority if rec.priority is not None else 10
        else:
            priority = None

        if rec.name == "@":
            fqdn = f"{data.name}."
        else:
            fqdn = f"{rec.name}.{data.name}."

        if rec.type == "TXT":
            value_part = _txt_bind_rdatatext(rec.value)
        elif rec.type == "MX" and priority is not None:
            value_part = f"{priority} {_absolute_domain(rec.value)}"
        elif rec.type == "SRV" and priority is not None:
            parts = rec.value.strip().split()
            if len(parts) >= 3:
                w, port = parts[0], parts[1]
                tgt = " ".join(parts[2:])
                value_part = f"{priority} {w} {port} {_absolute_domain(tgt)}"
            else:
                value_part = f"{priority} {rec.value}"
        elif rec.type in ("NS", "CNAME"):
            value_part = _absolute_domain(rec.value)
        else:
            value_part = rec.value

        lines.append(f"{fqdn} {rec.ttl} IN {rec.type} {value_part}")

    zone_text = "\n".join(lines) + "\n"
    zone_file.write_text(zone_text, encoding="utf-8")

    ok, check_output = _check_zone(zone_name, zone_file)
    if not ok:
        if backup_path.exists():
            zone_file.write_text(backup_path.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            zone_file.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"named-checkzone failed: {check_output}",
        )

    if is_new_zone and not _is_zone_registered(zone_name):
        _register_zone(zone_name)
        try:
            result = _run_rndc("reconfig")
            if result.returncode != 0:
                return {**data.model_dump(), "warning": f"Zone saved but rndc reconfig failed: {result.stderr or result.stdout}"}
        except Exception as exc:
            return {**data.model_dump(), "warning": f"Zone saved but rndc reconfig error: {exc}"}

    return data


@app.delete("/zones/{zone_name:path}")
def delete_zone(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    zone_file = _zone_file_path(zone_name)
    if not zone_file.exists():
        raise HTTPException(status_code=404, detail=f"Zone file not found: {zone_file}")

    backup_path = zone_file.with_suffix(zone_file.suffix + ".bak")
    backup_path.write_text(zone_file.read_text(encoding="utf-8"), encoding="utf-8")
    zone_file.unlink()

    warning = None
    if NAMED_CONF_LOCAL.exists() and _is_zone_registered(zone_name):
        content = NAMED_CONF_LOCAL.read_text(encoding="utf-8")
        pattern = _zone_block_pattern(zone_name)
        content = re.sub(pattern, "\n", content, flags=re.DOTALL)
        NAMED_CONF_LOCAL.write_text(content.strip() + "\n", encoding="utf-8")
        try:
            result = _run_rndc("reconfig")
            if result.returncode != 0:
                warning = f"rndc reconfig failed: {result.stderr or result.stdout}"
        except Exception as exc:
            warning = f"rndc reconfig error: {exc}"

    _remove_zone_keys(zone_name)

    resp = {"status": "ok", "message": f"Zone {zone_name} deleted"}
    if warning:
        resp["warning"] = warning
    return resp



@app.get("/zones/{zone_name:path}/dnssec", response_model=DnssecStatus)
def get_dnssec_status(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    if not _zone_file_path(zone_name).exists():
        raise HTTPException(status_code=404, detail=f"Zone file not found: {zone_name}")
    enabled = _is_dnssec_enabled(zone_name)
    if not enabled:
        return DnssecStatus(enabled=False, message="DNSSEC не включён для этой зоны")
    ds_records = _fetch_ds_records(zone_name)
    dnskey = bool(_dig_short(zone_name, "DNSKEY"))
    message = None
    if not ds_records:
        message = (
            "DNSSEC включён, но DS ещё не сформированы. "
            "Сохраните зону и нажмите «Перезагрузить BIND», затем обновите статус."
        )
    return DnssecStatus(
        enabled=True,
        ds_records=ds_records,
        dnskey_present=dnskey,
        message=message,
    )


@app.post("/zones/{zone_name:path}/dnssec/enable")
def enable_dnssec(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    if not _zone_file_path(zone_name).exists():
        raise HTTPException(status_code=404, detail=f"Zone file not found: {zone_name}")
    if not _is_zone_registered(zone_name):
        raise HTTPException(
            status_code=400,
            detail="Зона не зарегистрирована в BIND. Сначала сохраните зону.",
        )
    if _is_dnssec_enabled(zone_name):
        ds_records = _fetch_ds_records(zone_name)
        return {
            "status": "ok",
            "enabled": True,
            "ds_records": ds_records,
            "message": "DNSSEC уже включён",
        }

    _ensure_keys_dir_writable(zone_name)
    _set_zone_dnssec(zone_name, True)

    try:
        result = _run_rndc("reconfig")
        if result.returncode != 0:
            raise HTTPException(
                status_code=503,
                detail=f"rndc reconfig failed: {result.stderr or result.stdout}",
            )
        sign_warning = _dnssec_sign_zone(zone_name)
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="rndc not found")
    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="rndc timeout")

    ds_records = _fetch_ds_records_with_retry(zone_name)
    resp: dict = {
        "status": "ok",
        "enabled": True,
        "ds_records": ds_records,
        "message": "DNSSEC включён. Добавьте DS-записи у регистратора домена.",
    }
    if sign_warning:
        resp["warning"] = sign_warning
    if not ds_records:
        resp["message"] = (
            "DNSSEC включён, но DS пока не получены. "
            "Нажмите «Перезагрузить BIND» и «Обновить» в блоке DNSSEC."
        )
    return resp


@app.post("/zones/{zone_name:path}/dnssec/disable")
def disable_dnssec(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    if not _is_dnssec_enabled(zone_name):
        return {"status": "ok", "enabled": False, "message": "DNSSEC уже отключён"}

    _set_zone_dnssec(zone_name, False)
    try:
        result = _run_rndc("reconfig")
        if result.returncode != 0:
            raise HTTPException(
                status_code=503,
                detail=f"rndc reconfig failed: {result.stderr or result.stdout}",
            )
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="rndc not found")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="rndc timeout")

    _remove_zone_keys(zone_name)
    return {
        "status": "ok",
        "enabled": False,
        "message": "DNSSEC отключён. Удалите DS-записи у регистратора, если они были добавлены.",
    }


@app.post("/zones/{zone_name:path}/reload")
def reload_zone(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    try:
        result = _run_rndc("reload", zone_name)
        if result.returncode != 0:
            raise HTTPException(
                status_code=503,
                detail=f"rndc reload failed: {result.stderr or result.stdout or 'unknown'}",
            )
        sign_warning = None
        if _is_dnssec_enabled(zone_name):
            sign_warning = _dnssec_sign_zone(zone_name)
        resp = {"status": "ok", "message": f"Zone {zone_name} reloaded"}
        if sign_warning:
            resp["warning"] = sign_warning
        if _is_dnssec_enabled(zone_name):
            ds = _fetch_ds_records_with_retry(zone_name)
            resp["ds_records"] = ds
            if ds:
                resp["message"] = f"Zone {zone_name} reloaded. DS-записи готовы для регистратора."
        return resp
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="rndc not found in the container. Check that bind9-utils is installed.",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="rndc reload timeout")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/zones/{zone_name:path}")
def get_zone_raw(zone_name: str, _user: str = Depends(get_current_user)):
    if not _is_safe_zone_path_component(zone_name):
        raise HTTPException(status_code=400, detail="Некорректное имя зоны")
    zone_file = ZONES_DIR / f"db.{zone_name}"
    if not zone_file.exists():
        raise HTTPException(status_code=404, detail=f"Zone file not found: {zone_file}")

    try:
        content = zone_file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = zone_file.read_text(errors="ignore")

    return {"zone": zone_name, "file": str(zone_file), "content": content}
