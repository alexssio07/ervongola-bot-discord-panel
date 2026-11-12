#!/usr/bin/env python3
"""
Helper una-tantum per generare l'hash della password admin da mettere in
api/.env come ADMIN_PASSWORD_HASH. Usa werkzeug.security (già una
dipendenza di Flask), quindi non serve installare nulla in più.

Uso:
    python hash_password.py "la-mia-password-sicura"
"""

import sys

from werkzeug.security import generate_password_hash

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Uso: python hash_password.py <password>")
        sys.exit(1)

    print(generate_password_hash(sys.argv[1]))
