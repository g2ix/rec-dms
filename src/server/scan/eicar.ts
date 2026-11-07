/** Industry antivirus test string. It is not malware. */
const MARKER = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

export function containsEicar(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("latin1");
  return text.includes(MARKER);
}
