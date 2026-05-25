$TTL 3600
mydomain.ru. IN SOA ns1.mydomain.ru. admin.mydomain.ru. (
  2024010110 ; serial
  3600 ; refresh
  900 ; retry
  604800 ; expire
  86400 ) ; minimum

mydomain.ru. 3600 IN NS ns1.mydomain.ru.
mydomain.ru. 3600 IN NS ns2.mydomain.ru.
mydomain.ru. 3600 IN A 192.0.2.50
mydomain.ru. 3600 IN MX 10 mail.mydomain.ru.
mail.mydomain.ru. 3600 IN A 192.0.2.50
ns1.mydomain.ru. 3600 IN A 192.0.2.10
ns2.mydomain.ru. 3600 IN A 192.0.2.11
test.mydomain.ru. 3600 IN A 192.0.2.99
