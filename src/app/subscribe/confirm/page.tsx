import type { Metadata } from "next";
import { Suspense } from "react";
import EmailLinkAction from "@/components/stories/EmailLinkAction";

export const metadata: Metadata = {
  title: "Confirm the emails",
  robots: { index: false, follow: false },
};

/** The page behind the link in a story email: a press says yes to the invitation. */
export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <EmailLinkAction action="confirm" />
    </Suspense>
  );
}
