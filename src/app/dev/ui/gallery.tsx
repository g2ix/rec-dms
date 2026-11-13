"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { Icon } from "@/components/icons";
import { SidebarPanel } from "@/components/shell/sidebar";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { BlurLoad } from "@/components/ui/blur-load";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PlaceholderBar } from "@/components/ui/placeholder-bar";
import { ProgressRow } from "@/components/ui/progress-row";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Gallery() {
  return (
    <main className="dev-ui">
      <header className="dev-ui__bar">
        <h1 className="title">Components</h1>
        <ThemeSwitch />
        <Link href="/app">Open the app shell</Link>
      </header>
      <div className="dev-themes">
        <section className="dev-theme" data-theme="light" aria-label="Light theme">
          <h2 className="heading">Light</h2>
          <Samples />
        </section>
        <section className="dev-theme" data-theme="dark" aria-label="Dark theme">
          <h2 className="heading">Dark</h2>
          <Samples />
        </section>
      </div>
    </main>
  );
}

function Samples() {
  const base = useId();
  const [busy, setBusy] = useState(false);
  const [segment, setSegment] = useState("tasks");
  const [review, setReview] = useState("initial");
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="dev-block">
        <h3 className="subheading">Type</h3>
        <p className="display">Research Ethics Committee</p>
        <p className="title">Protocol Review Assessment Form</p>
        <p className="heading">1. Scientific validity</p>
        <p className="subheading">Researcher(s)/Proponent(s)</p>
        <p className="body">Please indicate the page and paragraph where this information can be found.</p>
        <p className="body-sm">Juan D. Cruz, Juana S. Santos</p>
        <p className="label">Due in 2 working days</p>
        <p className="caption">Saved 2 seconds ago</p>
        <p className="code">USC-REC-2026-0123</p>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Text on surfaces</h3>
        <p className="dev-swatch" style={{ background: "var(--bg)", color: "var(--ink)" }}>Ink on page</p>
        <p className="dev-swatch" style={{ background: "var(--surface)", color: "var(--ink-muted)" }}>Muted on surface</p>
        <p className="dev-swatch" style={{ background: "var(--primary)", color: "var(--on-primary)" }}>On primary</p>
        <p className="dev-swatch" style={{ background: "var(--primary-soft)", color: "var(--primary-ink)" }}>Approved</p>
        <p className="dev-swatch" style={{ background: "var(--danger)", color: "var(--on-danger)" }}>On danger</p>
        <p className="dev-swatch" style={{ background: "var(--danger-soft)", color: "var(--danger-ink)" }}>Disapproved</p>
        <p className="dev-swatch" style={{ background: "var(--info-soft)", color: "var(--info-ink)" }}>Under review</p>
        <p className="dev-swatch" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>Returned</p>
        <p className="body" style={{ color: "var(--primary)" }}>Link on surface</p>
        <p className="body" style={{ color: "var(--danger)" }}>Overdue 4 Nov 2026</p>
        <p className="body" style={{ color: "var(--warning)" }}>Due 6 Nov 2026</p>
        <p className="body" style={{ color: "var(--info)" }}>Under review</p>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Buttons</h3>
        <div className="dev-stack">
          <Button variant="primary" onClick={() => undefined}>
            <Icon icon={FileText} />
            Sign F-27
          </Button>
          <Button variant="secondary">Return to proponent</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Remove member</Button>
          <Button variant="primary" disabled>
            Release decision
          </Button>
          <BusyButton
            variant="primary"
            busy={busy}
            busyLabel="Submitting…"
            onClick={() => {
              setBusy(true);
              window.setTimeout(() => setBusy(false), 1200);
            }}
          >
            Submit for review
          </BusyButton>
        </div>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Choice</h3>
        <Toggle label="Email me when a task is assigned" defaultChecked />
        <Checkbox label="I confirm that the information in this application is accurate." />
        <Checkbox label="Checked declaration" defaultChecked />
        <RadioGroup label="Review route">
          <Radio name={`${base}-route`} label="Full review" value="full" defaultChecked />
          <Radio name={`${base}-route`} label="Expedited review" value="expedited" />
        </RadioGroup>
        <SegmentedControl
          label="View"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "tasks", label: "Tasks" },
            { value: "protocols", label: "Protocols" },
          ]}
        />
        <ThemeSwitch />
      </section>

      <section className="dev-block">
        <h3 className="subheading">Status</h3>
        <div className="dev-stack">
          <StatusBadge tone="draft" label="Draft" />
          <StatusBadge tone="info" label="Under review" />
          <StatusBadge tone="warning" label="Returned" />
          <StatusBadge tone="success" label="Approved" />
          <StatusBadge tone="danger" label="Disapproved" />
        </div>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Fields</h3>
        <Field label="Protocol title" help="Use the title on the cover page." htmlFor={`${base}-title`}>
          <Input id={`${base}-title`} defaultValue="Community health study" />
        </Field>
        <Field label="Sponsor" optional htmlFor={`${base}-sponsor`}>
          <Input id={`${base}-sponsor`} placeholder="Name of the sponsor" />
        </Field>
        <Field label="Summary" error="This field needs the page and paragraph number, or NA with a reason." htmlFor={`${base}-summary`}>
          <Textarea id={`${base}-summary`} defaultValue="" />
        </Field>
        <Field label="Notes" saveState="saving" htmlFor={`${base}-notes`}>
          <Input id={`${base}-notes`} defaultValue="Draft note" />
        </Field>
        <Field label="Version" saveState="saved" htmlFor={`${base}-version`}>
          <Input id={`${base}-version`} defaultValue="2/28May2022" />
        </Field>
        <Field
          label="Researchers"
          saveState="conflict"
          conflict="Changed by Juana S. Santos a moment ago. Review"
          htmlFor={`${base}-researchers`}
        >
          <Input id={`${base}-researchers`} defaultValue="Juan D. Cruz" />
        </Field>
        <Field label="Protocol title" locked>
          Community health study
        </Field>
        <Field label="Review type" htmlFor={`${base}-review`}>
          <Select
            value={review}
            items={{ initial: "Initial review", resubmission: "Resubmission" }}
            onValueChange={(value) => setReview(value ?? "initial")}
          >
            <SelectTrigger id={`${base}-review`} aria-label="Review type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="initial">Initial review</SelectItem>
              <SelectItem value="resubmission">Resubmission</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Table and card</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Protocol code</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="code">USC-REC-2026-0123</TableCell>
              <TableCell>Community health study</TableCell>
              <TableCell>
                <StatusBadge tone="info" label="Submitted" />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Card>
          <CardHeader>
            <CardTitle>Submission</CardTitle>
            <CardDescription>One card, a hairline, no shadow.</CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Overlays</h3>
        <div className="dev-stack">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger className="rec-btn rec-btn--secondary">
              <span>Open dialog</span>
            </DialogTrigger>
            <DialogContent title="Return to proponent">
              <DialogDescription>The proponent will see your note on the protocol.</DialogDescription>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setOpen(false)}>
                  Return to proponent
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger className="rec-btn rec-btn--secondary">
              <span>Actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Sign F-27</DropdownMenuItem>
              <DropdownMenuItem variant="danger">Remove member</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger className="rec-btn rec-btn--ghost">
              <span>Hover for help</span>
            </TooltipTrigger>
            <TooltipContent>Page and paragraph, or NA with a reason.</TooltipContent>
          </Tooltip>
          <Button variant="secondary" onClick={() => toast("PDF ready")}>
            Show background result
          </Button>
        </div>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Loading</h3>
        <BlurLoad state="loading" placeholder={<PlaceholderBar width="180px" />}>
          <p className="body">Ready content</p>
        </BlurLoad>
        <BlurLoad state="ready" placeholder={<PlaceholderBar />}>
          <p className="body">Protocol package is ready.</p>
        </BlurLoad>
        <BlurLoad state="stale">
          <p className="body">This list is refreshing.</p>
        </BlurLoad>
        <ProgressRow label="Preparing PDF of F-35…" value={40} />
        <ProgressRow label="Preparing the package…" />
      </section>

      <section className="dev-block">
        <h3 className="subheading">Sidebar</h3>
        <div className="dev-frame">
          <SidebarPanel
            pathname="/app"
            collapsed={false}
            markerId={`${base}-expanded`}
            counts={{ "/app/tasks": { value: 2, overdue: true } }}
          />
        </div>
        <div className="dev-frame">
          <SidebarPanel pathname="/app" collapsed markerId={`${base}-rail`} />
        </div>
      </section>

      <section className="dev-block">
        <h3 className="subheading">Sign-in</h3>
        <AuthFrame title="Sign in to REC-DMS" titleAs="p" standalone>
          <p className="body">The sign-in card sits here.</p>
        </AuthFrame>
      </section>
    </>
  );
}
