import type { Metadata } from "next";
import TryOnClient from "./TryOnClient";

export const metadata: Metadata = {
  title: "Try it on",
  description:
    "Open your camera, put the Kitty cap, hoodie or long-sleeve on yourself or a friend, and meet Kitty beside you. Nothing is uploaded.",
};

export default function TryOnPage() {
  return <TryOnClient />;
}
