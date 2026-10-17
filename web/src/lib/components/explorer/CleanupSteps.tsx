import { ArrowRight } from "lucide-react";

/** A workflow's numbered steps, joined by arrows, as the AI cleanup review shows them. */
export function CleanupSteps({ steps }: { steps?: string[] | null }) {
  if (!steps?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
      {steps.map((s, si) => (
        <span key={si} className="contents">
          <span>
            {si + 1}. {s}
          </span>
          {si < steps.length - 1 ? <ArrowRight className="size-3 inline" /> : null}
        </span>
      ))}
    </div>
  );
}
