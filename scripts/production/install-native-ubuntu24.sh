#!/usr/bin/env bash
# Обратная совместимость — вызывает deploy-native.sh
exec "$(dirname "$0")/../deploy-native.sh" "$@"
