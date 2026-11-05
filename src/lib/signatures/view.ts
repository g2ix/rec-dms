export type SignatureSlotView = {
  fieldPath: string;
  label: string;
  required: boolean;
  canSign: boolean;
  waiting: string | null;
  status: "unsigned" | "signed" | "void";
  signerName: string | null;
  signedAtLabel: string | null;
  verifyRef: string | null;
  imageDataUrl: string | null;
};

export type SigningPrompt = {
  instanceId: string;
  hasPassword: boolean;
  fresh: boolean;
  email: string | null;
};
