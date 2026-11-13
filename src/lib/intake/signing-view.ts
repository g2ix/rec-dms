/** What the Agree and sign step shows for each researcher. Safe to send to the browser. */
export type SigningRowState = "signed" | "again" | "unsigned";

export type SigningRow = {
  memberId: string;
  name: string;
  /** The viewer's own row: the only one with a button, the date and the image. */
  mine: boolean;
  /** Agreed to the F-27 declarations and gave the F-28 consents. */
  agreed: boolean;
  /** signed: both forms; again: a signature was voided (or one form is still to sign); unsigned: neither. */
  state: SigningRowState;
  /** The forms the next signing act signs: both, or only the voided one(s). */
  toSign: string[];
  /** Own row only. */
  signedOnLabel: string | null;
  imageDataUrl: string | null;
};

export type IntakeSigningView = {
  forms: { code: string; title: string }[];
  rows: SigningRow[];
  /** Whether the viewer can sign or withdraw now: a proponent on a working version. */
  editable: boolean;
  /** How the viewer confirms it is them: password, or a code emailed to their contact email. */
  prompt: { hasPassword: boolean; fresh: boolean; email: string | null };
  /** The viewer's saved signature image, shown in the dialog before signing. */
  savedImageDataUrl: string | null;
};
