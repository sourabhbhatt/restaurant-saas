"use client";

/**
 * Design-system showcase for reviewing every UI primitive and feedback pattern
 * in its states. Fully static and client-only: no data access, no request APIs,
 * no time/random values during render, so it prerenders under cacheComponents.
 */

import * as React from "react";
import {
  BellIcon,
  BoldIcon,
  ChefHatIcon,
  ClockIcon,
  DollarSignIcon,
  InboxIcon,
  InfoIcon,
  ItalicIcon,
  DownloadIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UnderlineIcon,
  UsersIcon,
  UtensilsCrossedIcon,
  CircleCheckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@ros/ui/utils";
import { Alert, AlertDescription, AlertTitle } from "@ros/ui/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ros/ui/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage, getInitials } from "@ros/ui/ui/avatar";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ros/ui/ui/card";
import { Checkbox } from "@ros/ui/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ros/ui/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ros/ui/ui/dropdown-menu";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Label } from "@ros/ui/ui/label";
import { Pagination } from "@ros/ui/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@ros/ui/ui/popover";
import { Progress } from "@ros/ui/ui/progress";
import { RadioGroup, RadioGroupItem } from "@ros/ui/ui/radio-group";
import { ScrollArea } from "@ros/ui/ui/scroll-area";
import { SearchInput } from "@ros/ui/ui/search-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@ros/ui/ui/select";
import { Separator } from "@ros/ui/ui/separator";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  type SheetSide,
} from "@ros/ui/ui/sheet";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { Toaster } from "@ros/ui/ui/sonner";
import { Spinner } from "@ros/ui/ui/spinner";
import { Switch } from "@ros/ui/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@ros/ui/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ros/ui/ui/tabs";
import { Textarea } from "@ros/ui/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@ros/ui/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ros/ui/ui/tooltip";
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  PageSkeleton,
  StatCard,
  StatusBadge,
  type DataTableColumn,
  type PageSkeletonVariant,
  type StatusTone,
} from "@ros/ui/shared/feedback";

/* -------------------------------------------------------------------------- */
/* Sample data (static)                                                       */
/* -------------------------------------------------------------------------- */

type OrderStatus = "pending" | "preparing" | "ready" | "served" | "cancelled";

type Order = {
  id: string;
  table: string;
  items: number;
  waiter: string;
  total: string;
  status: OrderStatus;
};

const orderTone: Record<OrderStatus, StatusTone> = {
  pending: "warning",
  preparing: "info",
  ready: "success",
  served: "neutral",
  cancelled: "danger",
};

const orderLabel: Record<OrderStatus, string> = {
  pending: "Pending",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
};

const orders: Order[] = [
  { id: "#1042", table: "T4", items: 3, waiter: "Ana López", total: "$48.20", status: "pending" },
  { id: "#1041", table: "T12", items: 5, waiter: "Sam Lee", total: "$96.00", status: "preparing" },
  { id: "#1040", table: "T2", items: 2, waiter: "Ana López", total: "$22.50", status: "ready" },
  { id: "#1039", table: "Bar 1", items: 1, waiter: "Kai Ito", total: "$9.00", status: "served" },
  { id: "#1038", table: "T7", items: 4, waiter: "Sam Lee", total: "$61.75", status: "cancelled" },
];

const orderColumns: DataTableColumn<Order>[] = [
  { id: "id", header: "Order", cell: (o) => <span className="font-medium">{o.id}</span> },
  { id: "table", header: "Table", cell: (o) => o.table },
  { id: "items", header: "Items", cell: (o) => o.items, align: "right" },
  {
    id: "waiter",
    header: "Waiter",
    cell: (o) => o.waiter,
    className: "max-sm:hidden",
    headerClassName: "max-sm:hidden",
  },
  {
    id: "status",
    header: "Status",
    cell: (o) => (
      <StatusBadge tone={orderTone[o.status]} dot pulse={o.status === "preparing"}>
        {orderLabel[o.status]}
      </StatusBadge>
    ),
  },
  { id: "total", header: "Total", cell: (o) => o.total, align: "right" },
];

const tokenSwatches = [
  ["background", "bg-background", "text-foreground"],
  ["card", "bg-card", "text-card-foreground"],
  ["primary", "bg-primary", "text-primary-foreground"],
  ["secondary", "bg-secondary", "text-secondary-foreground"],
  ["muted", "bg-muted", "text-muted-foreground"],
  ["accent", "bg-accent", "text-accent-foreground"],
  ["destructive", "bg-destructive", "text-destructive-foreground"],
  ["success", "bg-success", "text-success-foreground"],
  ["warning", "bg-warning", "text-warning-foreground"],
  ["info", "bg-info", "text-info-foreground"],
] as const;

const chartSwatches = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

/** Brand presets demonstrating runtime re-branding through CSS variables only. */
const brandPresets = {
  ember: { label: "Ember (default)", light: "", dark: "" },
  basil: { label: "Basil", light: "oklch(0.5 0.13 150)", dark: "oklch(0.74 0.15 150)" },
  blueberry: { label: "Blueberry", light: "oklch(0.5 0.17 265)", dark: "oklch(0.74 0.13 265)" },
  plum: { label: "Plum", light: "oklch(0.5 0.17 330)", dark: "oklch(0.74 0.14 330)" },
} as const;
type BrandPreset = keyof typeof brandPresets;

const sections = [
  ["tokens", "Tokens"],
  ["buttons", "Buttons"],
  ["badges", "Badges"],
  ["forms", "Forms"],
  ["navigation", "Tabs & toggles"],
  ["overlays", "Overlays"],
  ["display", "Display"],
  ["table", "Table"],
  ["feedback", "Feedback"],
  ["patterns", "Page patterns"],
] as const;

/* -------------------------------------------------------------------------- */
/* Layout helpers                                                             */
/* -------------------------------------------------------------------------- */

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-5 flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Demo({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      <div className={cn("flex flex-wrap items-center gap-3 p-4 sm:p-6", className)}>
        {children}
      </div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DesignSystemPage() {
  const [dark, setDark] = React.useState(false);
  const [brand, setBrand] = React.useState<BrandPreset>("ember");

  // Theme + brand are applied to <html> so portalled overlays pick them up too.
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    const value = dark ? brandPresets[brand].dark : brandPresets[brand].light;
    for (const name of ["--primary", "--ring", "--sidebar-primary", "--chart-1"]) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
    return () => {
      root.classList.remove("dark");
      for (const name of ["--primary", "--ring", "--sidebar-primary", "--chart-1"]) {
        root.style.removeProperty(name);
      }
    };
  }, [dark, brand]);

  return (
    <div className="min-h-dvh bg-background">
      <Toaster position="top-right" />
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChefHatIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="font-semibold tracking-tight">RestaurantOS</span>
            <Badge variant="outline">Design system</Badge>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Select value={brand} onValueChange={(v) => setBrand(v as BrandPreset)}>
              <SelectTrigger size="sm" aria-label="Brand color preset" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {Object.entries(brandPresets).map(([key, preset]) => (
                  <SelectItem key={key} value={key}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={dark}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>
        </div>
        <nav aria-label="Sections" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2 sm:px-6">
          <ul className="flex gap-1 text-sm whitespace-nowrap">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-10 sm:px-6">
        <PageHeader
          title="Design system"
          description="Every primitive and feedback pattern in its states. All colors come from CSS variables in globals.css; use the brand picker to preview a re-brand."
        />
        <TokensSection />
        <ButtonsSection />
        <BadgesSection />
        <FormsSection />
        <NavigationSection />
        <OverlaysSection />
        <DisplaySection />
        <TableSection />
        <FeedbackSection />
        <PatternsSection />
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function TokensSection() {
  return (
    <Section
      id="tokens"
      title="Tokens"
      description="Semantic color tokens. Pair each surface with its -foreground token."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tokenSwatches.map(([name, bg, fg]) => (
          <div key={name} className="overflow-hidden rounded-xl border">
            <div className={cn("flex h-20 items-end p-3 text-sm font-medium", bg, fg)}>Aa</div>
            <div className="px-3 py-2 font-mono text-xs text-muted-foreground">{name}</div>
          </div>
        ))}
      </div>
      <Demo title="Charts">
        <div className="flex w-full gap-2">
          {chartSwatches.map((c, i) => (
            <div key={c} className="flex flex-1 flex-col gap-1">
              <div className={cn("h-10 rounded-md", c)} />
              <span className="font-mono text-xs text-muted-foreground">chart-{i + 1}</span>
            </div>
          ))}
        </div>
      </Demo>
      <Demo title="Radius & elevation">
        {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((r) => (
          <div
            key={r}
            className={cn(
              "flex size-20 items-center justify-center border bg-card text-xs shadow-xs",
              r,
            )}
          >
            {r.replace("rounded-", "")}
          </div>
        ))}
        <div className="flex size-20 items-center justify-center rounded-xl border bg-popover text-xs shadow-md">
          shadow-md
        </div>
        <div className="flex size-20 items-center justify-center rounded-xl border bg-popover text-xs shadow-lg">
          shadow-lg
        </div>
      </Demo>
    </Section>
  );
}

function ButtonsSection() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      description="Default and lg sizes are 40px+ tall on mobile for comfortable touch targets."
    >
      <Demo title="Variants">
        <Button>Accept order</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="success">
          <CircleCheckIcon /> Mark ready
        </Button>
        <Button variant="warning">
          <TriangleAlertIcon /> Delay
        </Button>
        <Button variant="destructive">
          <Trash2Icon /> Void
        </Button>
      </Demo>
      <Demo title="Sizes">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
        <Button size="icon-sm" variant="outline" aria-label="Edit">
          <PencilIcon />
        </Button>
        <Button size="icon" variant="outline" aria-label="Add item">
          <PlusIcon />
        </Button>
        <Button size="icon-lg" aria-label="Notifications">
          <BellIcon />
        </Button>
      </Demo>
      <Demo title="States">
        <Button disabled>Disabled</Button>
        <Button disabled>
          <Spinner decorative /> Saving…
        </Button>
        <Button variant="outline" aria-invalid>
          Invalid
        </Button>
        <Button asChild variant="outline">
          <a href="#buttons">As link</a>
        </Button>
      </Demo>
    </Section>
  );
}

function BadgesSection() {
  return (
    <Section id="badges" title="Badges & status">
      <Demo title="Badge variants">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="info">
          <InfoIcon /> With icon
        </Badge>
      </Demo>
      <Demo title="StatusBadge tones">
        {(["neutral", "info", "success", "warning", "danger"] as const).map((tone) => (
          <StatusBadge key={tone} tone={tone}>
            {tone}
          </StatusBadge>
        ))}
        <Separator orientation="vertical" className="h-5!" />
        {(Object.keys(orderTone) as OrderStatus[]).map((s) => (
          <StatusBadge key={s} tone={orderTone[s]} dot pulse={s === "preparing"}>
            {orderLabel[s]}
          </StatusBadge>
        ))}
      </Demo>
    </Section>
  );
}

function FormsSection() {
  const [search, setSearch] = React.useState("");
  const [notify, setNotify] = React.useState(true);

  return (
    <Section
      id="forms"
      title="Forms"
      description="FormField wires label, description and error to the control (aria-invalid, aria-describedby)."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="FormField" className="grid items-stretch gap-5">
          <FormField label="Restaurant name" description="Shown on menus and receipts." required>
            <Input placeholder="La Brasa" />
          </FormField>
          <FormField label="Contact email" error="Enter a valid email address">
            <Input type="email" defaultValue="owner@" />
          </FormField>
          <FormField
            label="Password"
            labelAction={
              <a href="#forms" className="text-sm text-primary underline-offset-4 hover:underline">
                Forgot?
              </a>
            }
          >
            <Input type="password" defaultValue="secret" />
          </FormField>
          <FormField label="Kitchen notes" description="Max 200 characters.">
            <Textarea placeholder="Allergies, timing, special requests…" />
          </FormField>
          <FormField label="Disabled field">
            <Input disabled defaultValue="Read only" />
          </FormField>
        </Demo>

        <Demo title="Selection controls" className="grid items-stretch gap-5">
          <FormField label="Role" error="Choose a role">
            {(controlProps) => (
              <Select>
                <SelectTrigger {...controlProps} className="w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Front of house</SelectLabel>
                    <SelectItem value="waiter">Waiter</SelectItem>
                    <SelectItem value="host">Host</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Back of house</SelectLabel>
                    <SelectItem value="chef">Chef</SelectItem>
                    <SelectItem value="runner" disabled>
                      Runner (unavailable)
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </FormField>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox id="ds-terms" defaultChecked />
              <Label htmlFor="ds-terms">Print kitchen ticket</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ds-indeterminate" checked="indeterminate" />
              <Label htmlFor="ds-indeterminate">Some tables selected</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ds-disabled" disabled />
              <Label htmlFor="ds-disabled">Disabled</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ds-invalid" aria-invalid />
              <Label htmlFor="ds-invalid">Invalid</Label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ds-notify">Order notifications</Label>
              <span className="text-sm text-muted-foreground">
                {notify ? "Enabled" : "Disabled"}
              </span>
            </div>
            <Switch id="ds-notify" checked={notify} onCheckedChange={setNotify} />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ds-switch-disabled" disabled />
            <Label htmlFor="ds-switch-disabled">Disabled switch</Label>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">Service type</legend>
            <RadioGroup defaultValue="dine-in">
              {[
                ["dine-in", "Dine in"],
                ["takeaway", "Takeaway"],
                ["delivery", "Delivery (coming soon)"],
              ].map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem
                    id={`ds-${value}`}
                    value={value ?? ""}
                    disabled={value === "delivery"}
                  />
                  <Label htmlFor={`ds-${value}`}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </Demo>
      </div>

      <Demo title="SearchInput" className="grid items-stretch gap-3 sm:grid-cols-2">
        <SearchInput
          aria-label="Search menu items"
          placeholder="Search menu items…"
          value={search}
          onValueChange={setSearch}
        />
        <SearchInput aria-label="Search (prefilled)" defaultValue="Margherita" />
        <SearchInput aria-label="Search (disabled)" placeholder="Disabled" disabled />
        <SearchInput aria-label="Search (invalid)" defaultValue="%%" aria-invalid />
      </Demo>
    </Section>
  );
}

function NavigationSection() {
  const [view, setView] = React.useState("all");
  return (
    <Section id="navigation" title="Tabs & toggles">
      <Demo title="Tabs" className="block">
        <Tabs defaultValue="dine-in">
          <TabsList>
            <TabsTrigger value="dine-in">Dine in</TabsTrigger>
            <TabsTrigger value="takeaway">Takeaway</TabsTrigger>
            <TabsTrigger value="archived" disabled>
              Archived
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dine-in" className="pt-3 text-sm text-muted-foreground">
            12 open tables, 4 awaiting payment.
          </TabsContent>
          <TabsContent value="takeaway" className="pt-3 text-sm text-muted-foreground">
            3 takeaway orders in the queue.
          </TabsContent>
        </Tabs>
      </Demo>
      <Demo title="ToggleGroup">
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v)}
          aria-label="Order filter"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="multiple" aria-label="Text formatting">
          <ToggleGroupItem value="bold" aria-label="Bold">
            <BoldIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="italic" aria-label="Italic">
            <ItalicIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="underline" aria-label="Underline">
            <UnderlineIcon />
          </ToggleGroupItem>
        </ToggleGroup>
      </Demo>
    </Section>
  );
}

function OverlaysSection() {
  const [sound, setSound] = React.useState(true);
  const [density, setDensity] = React.useState("comfortable");

  return (
    <Section id="overlays" title="Overlays">
      <Demo title="Dialog, alert dialog, sheet">
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon /> New table
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add table</DialogTitle>
              <DialogDescription>Tables get a QR code for self-ordering.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <FormField label="Table name" required>
                <Input placeholder="T14" />
              </FormField>
              <FormField label="Seats" description="Used for reservations.">
                <Input type="number" inputMode="numeric" defaultValue={4} />
              </FormField>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => toast.success("Table T14 created")}>Create table</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Alert dialog</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Close the kitchen for today?</AlertDialogTitle>
              <AlertDialogDescription>
                New orders will be paused until you reopen it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep open</AlertDialogCancel>
              <AlertDialogAction>Close kitchen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {(["right", "left", "bottom", "top"] as SheetSide[]).map((side) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button variant="outline">Sheet {side}</Button>
            </SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle>Order #1042</SheetTitle>
                <SheetDescription>Table T4 · 3 items</SheetDescription>
              </SheetHeader>
              <SheetBody className="flex flex-col gap-3 text-sm">
                <div className="flex justify-between">
                  <span>2× Margherita</span>
                  <span data-numeric>$28.00</span>
                </div>
                <div className="flex justify-between">
                  <span>1× Tiramisu</span>
                  <span data-numeric>$8.20</span>
                </div>
                <Separator />
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span data-numeric>$36.20</span>
                </div>
              </SheetBody>
              <SheetFooter>
                <Button>Send to kitchen</Button>
                <SheetClose asChild>
                  <Button variant="outline">Close</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        ))}
      </Demo>

      <Demo title="Dropdown menu, popover, tooltip">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Order actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Order #1042</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <PencilIcon /> Edit
                <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ReceiptIcon /> Print bill
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UsersIcon /> Reassign
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Ana López</DropdownMenuItem>
                  <DropdownMenuItem>Sam Lee</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled>Split bill (soon)</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={sound} onCheckedChange={setSound}>
              Sound alerts
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Density</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
              <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2Icon /> Void order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <SettingsIcon /> Popover
            </Button>
          </PopoverTrigger>
          <PopoverContent className="grid gap-3">
            <p className="text-sm font-medium">Prep time</p>
            <FormField label="Minutes" hideLabel>
              <Input type="number" defaultValue={15} />
            </FormField>
            <Button size="sm">Save</Button>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Average wait time">
              <ClockIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Average wait: 12 min</TooltipContent>
        </Tooltip>
      </Demo>

      <Demo title="Toasts (sonner)">
        <Button variant="outline" onClick={() => toast("Order #1043 received")}>
          Default
        </Button>
        <Button variant="outline" onClick={() => toast.success("Payment captured")}>
          Success
        </Button>
        <Button variant="outline" onClick={() => toast.info("Table T4 requested the bill")}>
          Info
        </Button>
        <Button variant="outline" onClick={() => toast.warning("Low stock: burrata")}>
          Warning
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.error("Printer offline", {
              description: "Tickets are queued and will print on reconnect.",
            })
          }
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.promise(wait(1500), {
              loading: "Syncing orders…",
              success: "All orders synced",
              error: "Sync failed",
            })
          }
        >
          Promise
        </Button>
      </Demo>
    </Section>
  );
}

function DisplaySection() {
  return (
    <Section id="display" title="Display">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tonight&apos;s service</CardTitle>
            <CardDescription>Friday · 18:00 - 23:30</CardDescription>
            <CardAction>
              <Badge variant="success">Open</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span>Covers booked</span>
                <span data-numeric className="font-medium">
                  86 / 120
                </span>
              </div>
              <Progress value={72} aria-label="Covers booked" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <span>Kitchen capacity</span>
                <span data-numeric className="font-medium">
                  92%
                </span>
              </div>
              <Progress value={92} indicatorClassName="bg-warning" aria-label="Kitchen capacity" />
            </div>
          </CardContent>
          <CardFooter className="gap-2 border-t">
            <Button size="sm">View floor plan</Button>
            <Button size="sm" variant="ghost">
              Details
            </Button>
          </CardFooter>
        </Card>

        <div className="flex flex-col gap-3">
          <Alert>
            <InfoIcon />
            <AlertTitle>Default alert</AlertTitle>
            <AlertDescription>Menu changes publish to all branches.</AlertDescription>
          </Alert>
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>New feature</AlertTitle>
            <AlertDescription>Guests can now split bills from their phone.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <CircleCheckIcon />
            <AlertTitle>Menu published</AlertTitle>
            <AlertDescription>42 items are live on your QR menu.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Trial ends in 3 days</AlertTitle>
            <AlertDescription>Add a payment method to keep ordering online.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>The card was declined. Try another card.</AlertDescription>
          </Alert>
        </div>
      </div>

      <Demo title="Avatar, spinner, skeleton, separator">
        <div className="flex -space-x-2">
          <Avatar className="ring-2 ring-background">
            <AvatarImage src="/icons/icon-192.png" alt="RestaurantOS" />
            <AvatarFallback>RO</AvatarFallback>
          </Avatar>
          {["Ana López", "Sam Lee", "Kai Ito"].map((n) => (
            <Avatar key={n} className="ring-2 ring-background">
              <AvatarFallback>{getInitials(n)}</AvatarFallback>
            </Avatar>
          ))}
        </div>
        <Avatar className="size-10">
          <AvatarFallback className="bg-primary/10 text-primary">
            <ChefHatIcon className="size-4" />
          </AvatarFallback>
        </Avatar>
        <Separator orientation="vertical" className="h-8!" />
        <Spinner />
        <Spinner className="size-6 text-primary" />
        <Separator orientation="vertical" className="h-8!" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </Demo>

      <Demo title="ScrollArea" className="block">
        <ScrollArea className="h-48 rounded-lg border">
          <ul className="p-2">
            {Array.from({ length: 24 }, (_, i) => (
              <li key={i} className="rounded-md px-3 py-2 text-sm hover:bg-muted">
                Ticket {String(i + 1).padStart(3, "0")} · Table T{(i % 12) + 1}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Demo>
    </Section>
  );
}

function TableSection() {
  const [page, setPage] = React.useState(3);
  return (
    <Section id="table" title="Table primitives & pagination">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableCaption className="pb-4">Recent bills</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Bill</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ["B-311", "T4", "Card", "$48.20"],
              ["B-310", "T9", "Cash", "$31.00"],
              ["B-309", "T1", "Card", "$112.40"],
            ].map(([bill, table, method, amount]) => (
              <TableRow key={bill}>
                <TableCell className="font-medium">{bill}</TableCell>
                <TableCell>{table}</TableCell>
                <TableCell>{method}</TableCell>
                <TableCell className="text-right">{amount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Total</TableCell>
              <TableCell className="text-right">$191.60</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <Demo title="Pagination (controlled)" className="flex-col">
        <Pagination page={page} pageCount={12} onPageChange={setPage} />
        <p className="text-sm text-muted-foreground">Current page: {page}</p>
        <Pagination page={1} pageCount={4} onPageChange={() => {}} disabled />
      </Demo>
    </Section>
  );
}

function FeedbackSection() {
  const [skeleton, setSkeleton] = React.useState<PageSkeletonVariant>("list");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [failingOpen, setFailingOpen] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);

  return (
    <Section id="feedback" title="Feedback">
      <div className="grid gap-6 lg:grid-cols-2">
        <EmptyState
          icon={<InboxIcon />}
          title="No orders yet"
          description="Orders placed from QR menus and waiters will show up here in real time."
          action={
            <>
              <Button>
                <PlusIcon /> New order
              </Button>
              <Button variant="outline">Share QR menu</Button>
            </>
          }
        />
        <ErrorState
          message="We couldn't load today's orders. Check your connection and try again."
          error={{ digest: "4f2a9c1e" }}
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            void wait(1200).then(() => setRetrying(false));
          }}
        />
      </div>

      <Demo title="LoadingState" className="grid gap-4 sm:grid-cols-2">
        <LoadingState className="rounded-lg border" />
        <LoadingState label="Fetching menu…" className="rounded-lg border" />
      </Demo>

      <Demo title="PageSkeleton" className="block">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={skeleton}
          onValueChange={(v) => v && setSkeleton(v as PageSkeletonVariant)}
          aria-label="Skeleton variant"
          className="mb-4"
        >
          {(["list", "cards", "table", "detail"] as const).map((v) => (
            <ToggleGroupItem key={v} value={v} className="px-3 capitalize">
              {v}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <PageSkeleton variant={skeleton} count={skeleton === "cards" ? 3 : 4} />
      </Demo>

      <Demo title="ConfirmDialog">
        <Button variant="outline" onClick={() => setConfirmOpen(true)}>
          Confirm (async success)
        </Button>
        <Button variant="destructive" onClick={() => setFailingOpen(true)}>
          Destructive (fails)
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Publish menu changes?"
          description="12 items will be updated on every QR menu."
          confirmLabel="Publish"
          pendingLabel="Publishing…"
          onConfirm={async () => {
            await wait(1200);
            toast.success("Menu published");
          }}
        />
        <ConfirmDialog
          open={failingOpen}
          onOpenChange={setFailingOpen}
          title="Void order #1042?"
          description="The kitchen ticket is cancelled and the guest is notified. This can't be undone."
          confirmLabel="Void order"
          pendingLabel="Voiding…"
          destructive
          onConfirm={async () => {
            await wait(1000);
            throw new Error("This order was already served and can't be voided.");
          }}
        />
      </Demo>
    </Section>
  );
}

function PatternsSection() {
  const [mode, setMode] = React.useState<"rows" | "loading" | "empty">("rows");
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [selected, setSelected] = React.useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = orders.filter(
    (o) =>
      (status === "all" || o.status === status) &&
      (q === "" || `${o.id} ${o.table} ${o.waiter}`.toLowerCase().includes(q)),
  );

  return (
    <Section id="patterns" title="Page patterns">
      <PageHeader
        breadcrumbs={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5">
              <li>
                <a href="#patterns" className="hover:text-foreground">
                  La Brasa
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <a href="#patterns" className="hover:text-foreground">
                  Downtown
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground">
                Orders
              </li>
            </ol>
          </nav>
        }
        title="Orders"
        description="Live orders for the Downtown branch."
        actions={
          <>
            <Button variant="outline">
              <DownloadIcon /> Export
            </Button>
            <Button>
              <PlusIcon /> New order
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue today"
          value="$4,812"
          delta={12.4}
          deltaLabel="vs last Friday"
          icon={<DollarSignIcon />}
        />
        <StatCard
          label="Orders"
          value="128"
          delta={-3.1}
          deltaLabel="vs last Friday"
          icon={<ReceiptIcon />}
        />
        <StatCard
          label="Avg. wait"
          value="11 min"
          delta={-8}
          invertDelta
          deltaLabel="lower is better"
          icon={<ClockIcon />}
        />
        <StatCard label="Covers" value="—" icon={<UtensilsCrossedIcon />} loading />
      </div>

      <div className="flex flex-col gap-3">
        <FilterBar
          actions={
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mode}
              onValueChange={(v) => v && setMode(v as typeof mode)}
              aria-label="Table demo state"
            >
              <ToggleGroupItem value="rows" className="px-3">
                Rows
              </ToggleGroupItem>
              <ToggleGroupItem value="loading" className="px-3">
                Loading
              </ToggleGroupItem>
              <ToggleGroupItem value="empty" className="px-3">
                Empty
              </ToggleGroupItem>
            </ToggleGroup>
          }
        >
          <SearchInput
            aria-label="Search orders"
            placeholder="Search orders, tables, waiters…"
            value={query}
            onValueChange={setQuery}
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(orderLabel) as OrderStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {orderLabel[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>

        <DataTable
          aria-label="Orders"
          columns={orderColumns}
          rows={mode === "empty" ? [] : filtered}
          rowKey="id"
          loading={mode === "loading"}
          onRowClick={(o) => setSelected(o.id)}
          rowLabel={(o) => `Open order ${o.id}`}
          empty={
            <EmptyState
              size="compact"
              icon={<InboxIcon />}
              title={q || status !== "all" ? "No matching orders" : "No orders yet"}
              description={
                q || status !== "all"
                  ? "Try a different search or clear the filters."
                  : "New orders will appear here."
              }
              action={
                q || status !== "all" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selected ? `Selected order ${selected}` : "Click or press Enter on a row to select it."}
        </p>
      </div>
    </Section>
  );
}
