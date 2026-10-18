#!/bin/sh
# Creates the "Yes Machine Local Signing" certificate in this Mac's login keychain, once. Mac builds are then
# signed with it (scripts/sign-mac-local.cjs), so macOS keeps Screen Recording and Accessibility across rebuilds.
# The certificate is self-signed and valid for ten years; its key stays in the keychain, usable by codesign.
# Run it with: sh scripts/create-mac-signing-certificate.sh. Running it again does nothing once the certificate exists.
set -eu
NAME="Yes Machine Local Signing"
if security find-identity -p codesigning | grep -q "\"$NAME\""; then
  echo "$NAME already exists."
  exit 0
fi
# The key and the certificate are made in a private temporary folder (umask 077), removed when the script exits.
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
umask 077
# The certificate's settings: not a certificate authority, and good only for signing code.
cat > "$DIR/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
# A new 2048-bit RSA key and a self-signed certificate for it, valid for 3650 days. -nodes leaves the key file
# unencrypted; it only lives in the temporary folder until the import below.
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$DIR/cert.cnf" -keyout "$DIR/key.pem" -out "$DIR/cert.pem" 2>/dev/null
# The keychain imports the key and the certificate together as a PKCS#12 file, protected by a random password.
PASS=$(openssl rand -hex 16)
# -legacy keeps the PKCS#12 encryption that the macOS keychain imports; LibreSSL's openssl doesn't need it.
LEGACY=$(openssl version | grep -q '^OpenSSL 3' && echo -legacy || true)
openssl pkcs12 -export $LEGACY -name "$NAME" -inkey "$DIR/key.pem" -in "$DIR/cert.pem" -out "$DIR/id.p12" -passout "pass:$PASS"
# -T lets codesign use the key without asking each time.
security import "$DIR/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign
echo "Created $NAME. Rebuild the app, then approve its permissions one last time."
