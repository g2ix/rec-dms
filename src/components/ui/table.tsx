import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="rec-table-wrap">
      <table data-slot="table" className={cn("rec-table", className)} {...props} />
    </div>
  );
}

function TableHeader({ ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" {...props} />;
}

function TableBody({ ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />;
}

function TableFooter({ ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" {...props} />;
}

function TableRow({ ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" className={className} {...props} />;
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={className} {...props} />;
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("caption", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
