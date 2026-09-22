import type { Metadata } from "next";
import StoriesList from "./StoriesList";

export const metadata: Metadata = {
  title: "Kitty Stories",
  description:
    "Short true stories about Kitty, a black-and-white cat on the Thames. Added whenever something happens.",
};

export default function StoriesPage() {
  return <StoriesList />;
}
