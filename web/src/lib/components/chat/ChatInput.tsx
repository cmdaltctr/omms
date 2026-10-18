import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Select } from "$lib/components/ui/select";
import { Textarea } from "$lib/components/ui/textarea";
import { useI18n } from "$lib/i18n";
import type { TagInfo } from "$lib/types";
import type { ChatScope } from "@/hooks/useChat";

const ALL = "__all__";
const CHOOSE = "__choose__";

type Props = {
  projects: TagInfo[];
  scope: ChatScope;
  scopeMissing: boolean;
  disabled: boolean;
  onScope: (scope: string | null) => void;
  onAsk: (question: string) => void;
};

/** The question box with its scope: one project or all projects. */
export function ChatInput({ projects, scope, scopeMissing, disabled, onScope, onAsk }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const blocked = disabled || scope === undefined;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (blocked || !text.trim()) return;
    onAsk(text.trim());
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-2 rounded-2xl border border-border bg-card p-2.5 shadow-sm"
    >
      <Textarea
        value={text}
        disabled={disabled}
        rows={2}
        maxLength={4000}
        placeholder={t("chat-input-placeholder")}
        aria-label={t("chat-input-placeholder")}
        className="min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{t("chat-scope-label")}</span>
          <Select
            className="h-8 min-w-0 max-w-64 flex-1 text-xs"
            aria-label={t("chat-scope-label")}
            disabled={disabled}
            value={scope === undefined ? CHOOSE : (scope ?? ALL)}
            onChange={(event) => {
              const value = event.target.value;
              if (value !== CHOOSE) onScope(value === ALL ? null : value);
            }}
          >
            {scope === undefined ? <option value={CHOOSE}>{t("chat-scope-missing")}</option> : null}
            <option value={ALL}>{t("chat-scope-all")}</option>
            {projects.map((project) => (
              <option key={project.tag} value={project.tag}>
                {project.projectName || project.displayName || project.tag}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={blocked || !text.trim()}
          aria-label={t("chat-send")}
        >
          <ArrowUp />
          {t("chat-send")}
        </Button>
      </div>
      {scopeMissing ? (
        <p className="text-xs text-muted-foreground">{t("chat-scope-choose")}</p>
      ) : null}
    </form>
  );
}
