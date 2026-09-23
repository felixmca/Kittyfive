import type { Metadata } from "next";
import { Suspense } from "react";
import EmailLinkAction from "@/components/stories/EmailLinkAction";

export const metadata: Metadata = {
  title: "Stop the emails",
  robots: { index: false, follow: false },
};

/** The page behind the link in a story email: a press stops the emails. */
export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <EmailLinkAction action="unsubscribe" />
    </Suspense>
  );
}
