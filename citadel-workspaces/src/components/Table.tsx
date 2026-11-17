import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ScheduleItem {
  time: string;
  monday: string;
  tuesday: string;
  wednesday: string;
}

interface TableProps {
  data?: ScheduleItem[];
  children?: React.ReactNode;
  className?: string;
}

const TableComponent = ({ data, children, className }: TableProps): JSX.Element => {
  if (children) {
    return (
      <div className="my-6 w-full overflow-y-auto">
        <UITable className={className}>
          {children}
        </UITable>
      </div>
    );
  }

  return (
    <div className="my-6 w-full overflow-y-auto">
      <UITable>
        <TableHeader>
          <TableRow className="border-b border-border">
            <TableHead className="text-foreground font-medium p-4 bg-card">Time</TableHead>
            <TableHead className="text-foreground font-medium p-4 bg-card">Monday</TableHead>
            <TableHead className="text-foreground font-medium p-4 bg-card">Tuesday</TableHead>
            <TableHead className="text-foreground font-medium p-4 bg-card">Wednesday</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((item, index) => (
            <TableRow 
              key={index}
              className="hover:bg-primary-accent/10 transition-colors"
            >
              <TableCell className="text-foreground/80">{item.time}</TableCell>
              <TableCell className="text-foreground/80">{item.monday}</TableCell>
              <TableCell className="text-foreground/80">{item.tuesday}</TableCell>
              <TableCell className="text-foreground/80">{item.wednesday}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </UITable>
    </div>
  );
};

export default TableComponent;