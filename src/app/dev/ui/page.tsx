import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata = { title: "Components" };

export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
