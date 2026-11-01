import { diffLines, type DiffLine } from "$lib/skills-model";
import { cn } from "$lib/utils";

const LINE_CLASS: Record<DiffLine["kind"], string> = {
  add: "bg-status-success/15 text-status-success",
  del: "bg-destructive/10 text-destructive-label",
  hunk: "text-status-info",
  ctx: "text-muted-foreground",
};

/** The server's line diff as monospace text, one line per row, coloured by its first character. */
export function ProposalDiff({ diff, label }: { diff: string; label: string }) {
  return (
    <pre
      dir="ltr"
      tabIndex={0}
      aria-label={label}
      className="max-h-96 overflow-auto rounded-lg border border-border bg-background py-1 font-mono text-xs leading-5"
    >
      {diffLines(diff).map((line, index) => (
        <code
          key={index}
          data-line={line.kind}
          className={cn("block px-2 whitespace-pre-wrap break-words", LINE_CLASS[line.kind])}
        >
          {line.text || " "}
        </code>
      ))}
    </pre>
  );
}
