import type { Metadata } from "next";
import StoreClient from "./StoreClient";

export const metadata: Metadata = {
  title: "Kitty Store",
  description:
    "Kitty's living room on the Thames. She walks you round three pieces of merch: an embroidered cap, an embroidered hoodie and a long-sleeve printed with the flyer that found her.",
};

export default function StorePage() {
  return <StoreClient />;
}
