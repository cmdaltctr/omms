/** Test-only control surface mounted by the isolated synthetic Vite preview. */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { Textarea } from "$lib/components/ui/textarea";
import { Tooltip } from "$lib/components/ui/tooltip";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function ControlSamples() {
  const [selected, setSelected] = React.useState("alpha");
  const [changes, setChanges] = React.useState(0);
  const [checked, setChecked] = React.useState(false);

  const selectChange = (event: { target: { value: string } }) => {
    setSelected(event.target.value);
    setChanges((count) => count + 1);
  };

  return (
    <section
      aria-label="Synthetic control samples"
      className="fixed inset-x-0 top-0 z-[70] max-h-screen overflow-y-auto border-b border-border bg-background p-3 text-foreground shadow-sm"
      data-preview-controls
      style={{ zIndex: 70 }}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 text-sm lg:grid-cols-3">
        <div className="space-y-2" data-preview-id="button-variants">
          <p className="font-medium">Buttons</p>
          <div className="flex flex-wrap gap-1.5">
            {(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map(
              (variant) => (
                <Button data-preview-id={`button-${variant}`} key={variant} variant={variant}>
                  {variant}
                </Button>
              )
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-preview-id="button-sizes">
            {(["default", "sm", "lg", "xs"] as const).map((size) => (
              <Button data-preview-id={`button-size-${size}`} key={size} size={size}>
                {size}
              </Button>
            ))}
            <Button aria-invalid="true" data-preview-id="button-disabled-invalid" disabled>
              Invalid disabled
            </Button>
          </div>
          <Tooltip content="Synthetic tooltip content">
            <Button data-preview-id="tooltip-trigger" size="xs" variant="outline">
              Tooltip
            </Button>
          </Tooltip>
        </div>

        <div className="grid grid-cols-2 gap-2" data-preview-id="field-states">
          <Label className="grid gap-1" htmlFor="sample-input">
            Input
            <Input data-preview-id="input-enabled" id="sample-input" value="Enabled" readOnly />
          </Label>
          <Label className="grid gap-1" htmlFor="sample-input-disabled">
            Disabled
            <Input
              data-preview-id="input-disabled"
              disabled
              id="sample-input-disabled"
              value="Disabled"
              readOnly
            />
          </Label>
          <Label className="grid gap-1" htmlFor="sample-input-invalid">
            Invalid
            <Input
              aria-invalid="true"
              data-preview-id="input-invalid"
              id="sample-input-invalid"
              value="Invalid"
              readOnly
            />
          </Label>
          <Label className="grid gap-1" htmlFor="sample-textarea">
            Textarea
            <Textarea
              data-preview-id="textarea-enabled"
              id="sample-textarea"
              value="Enabled text"
              readOnly
            />
          </Label>
          <Label className="grid gap-1" htmlFor="sample-textarea-disabled">
            Disabled textarea
            <Textarea
              data-preview-id="textarea-disabled"
              disabled
              id="sample-textarea-disabled"
              value="Disabled text"
              readOnly
            />
          </Label>
          <Label className="grid gap-1" htmlFor="sample-textarea-invalid">
            Invalid textarea
            <Textarea
              aria-invalid="true"
              data-preview-id="textarea-invalid"
              id="sample-textarea-invalid"
              value="Invalid text"
              readOnly
            />
          </Label>
        </div>

        <div className="space-y-2" data-preview-id="select-and-statuses">
          <Label className="grid max-w-48 gap-1" htmlFor="synthetic-select">
            Select
            <Select
              aria-label="Synthetic select"
              id="synthetic-select"
              onChange={selectChange}
              value={selected}
            >
              <option value="alpha">Alpha</option>
              <option value="beta">Beta</option>
              <option value="gamma">Gamma</option>
            </Select>
          </Label>
          <p data-preview-id="select-state">
            Last value: {selected}; changes: {changes}
          </p>
          <Label htmlFor="synthetic-checkbox">
            <Checkbox
              checked={checked}
              data-preview-id="checkbox"
              id="synthetic-checkbox"
              onCheckedChange={setChecked}
            />
            Synthetic checkbox
          </Label>
          <div className="flex flex-wrap gap-1.5" data-preview-id="badges">
            <Badge>Ready</Badge>
            <Badge variant="secondary">Queued</Badge>
            <Badge variant="destructive">Failed</Badge>
          </div>
          <Alert data-preview-id="alert-info">
            <Info />
            <AlertTitle>Information</AlertTitle>
            <AlertDescription>Synthetic status.</AlertDescription>
          </Alert>
          <Alert data-preview-id="alert-destructive" variant="destructive">
            <AlertCircle />
            <AlertTitle>Attention</AlertTitle>
            <AlertDescription>Synthetic warning.</AlertDescription>
          </Alert>
        </div>
      </div>
    </section>
  );
}

export function cleanup() {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
}

export function mountControlSamples() {
  cleanup();
  host = document.createElement("div");
  host.dataset.previewControlsHost = "true";
  document.body.prepend(host);
  root = createRoot(host);
  root.render(<ControlSamples />);
  return cleanup;
}
