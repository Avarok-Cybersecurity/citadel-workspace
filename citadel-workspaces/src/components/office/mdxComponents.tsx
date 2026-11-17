import type { MDXComponents } from 'mdx/types';
import { Highlight, themes } from "prism-react-renderer";
import Table from '../Table';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { documentAnchor } from "@/components/shared/DocumentLink";
import { AppZone } from "./app-zone/AppZone";

export const components: MDXComponents = {
  // Document headings render ONE LEVEL DOWN from their markdown level, because
  // the page already has an h1 — the office or room name in OfficeLayout. A `#`
  // that rendered as <h1> gave /workspace two of them, and a screen reader two
  // competing page titles. The whole chain shifts, so `#` then `##` still nests
  // rather than collapsing into two siblings. Sizes are unchanged: this is a
  // semantic correction, not a visual one.
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-4xl font-bold mb-4 text-foreground">{children}</h2>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-2xl font-semibold mb-3 text-foreground">{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-xl font-semibold mb-2 text-foreground">{children}</h4>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="text-lg font-semibold mb-2 text-foreground">{children}</h5>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <h6 className="text-base font-semibold mb-2 text-foreground">{children}</h6>
  ),
  // h6 has nowhere lower to go; it stays h6 rather than becoming a <p> and
  // vanishing from the heading outline entirely.
  h6: ({ children }: { children?: React.ReactNode }) => (
    <h6 className="text-sm font-semibold mb-2 text-foreground">{children}</h6>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-4 text-foreground/80">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside mb-4 text-foreground/80">{children}</ul>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="mb-2">{children}</li>
  ),
  // Document hrefs are written by whoever authored the node, so they go through
  // DocumentLink: internal ones navigate in the SPA instead of reloading the
  // page out from under the WASM client, and `javascript:` never becomes a link.
  // This path has no other sanitisation — `@mdx-js` evaluate() has no
  // urlTransform, unlike react-markdown — so DocumentLink is the only guard.
  a: documentAnchor,
  del: ({ children }: { children?: React.ReactNode }) => (
    <del className="text-muted-foreground line-through">{children}</del>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img src={src} alt={alt} className="max-w-full h-auto rounded-lg shadow-lg my-4" />
  ),
  table: ({ children, ...props }: React.DetailedHTMLProps<React.TableHTMLAttributes<HTMLTableElement>, HTMLTableElement>) => (
    <div className="my-6 w-full overflow-y-auto">
      <Table {...props} className="w-full border border-border">
        {children}
      </Table>
    </div>
  ),
  thead: TableHeader,
  tbody: TableBody,
  tr: ({ children, ...props }: React.DetailedHTMLProps<React.HTMLAttributes<HTMLTableRowElement>, HTMLTableRowElement>) => (
    <TableRow {...props} className="hover:bg-primary-accent/10 transition-colors">
      {children}
    </TableRow>
  ),
  th: ({ children, ...props }: React.DetailedHTMLProps<React.ThHTMLAttributes<HTMLTableHeaderCellElement>, HTMLTableHeaderCellElement>) => (
    <TableHead {...props} className="border-b border-border bg-muted/50 text-foreground font-medium p-4">
      {children}
    </TableHead>
  ),
  td: ({ children, ...props }: React.DetailedHTMLProps<React.TdHTMLAttributes<HTMLTableDataCellElement>, HTMLTableDataCellElement>) => (
    <TableCell {...props} className="border-b border-border text-foreground/80 p-4">
      {children}
    </TableCell>
  ),
  Card: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
    <Card className="bg-card border-border mb-6">
      <CardHeader>
        <CardTitle className="text-foreground">{title}</CardTitle>
        {description && <CardDescription className="text-foreground/80">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="text-foreground/80">{children}</CardContent>
    </Card>
  ),
  Alert: ({ title, children, variant = "default" }: { title: string; children: React.ReactNode; variant?: "default" | "destructive" }) => (
    <Alert variant={variant} className="mb-6 bg-card border-border">
      <AlertTitle className="text-foreground">{title}</AlertTitle>
      <AlertDescription className="text-foreground/80">{children}</AlertDescription>
    </Alert>
  ),
  Badge: ({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "secondary" | "destructive" | "outline" }) => {
    const getColorClass: (text: string) => "" | "text-success-emphasis flex items-center gap-1 inline-flex" | "text-destructive flex items-center gap-1 inline-flex" = (text: string): "" | "text-success-emphasis flex items-center gap-1 inline-flex" | "text-destructive flex items-center gap-1 inline-flex" => {
      if (text === 'In Progress' || text === 'Trending Up' || text === 'Growing Team') 
        return 'text-success-emphasis flex items-center gap-1 inline-flex';
      if (text === 'High Priority' || text === 'High Impact' || text === 'Active Hiring') 
        return 'text-destructive flex items-center gap-1 inline-flex';
      return '';
    };

    return (
      <Badge 
        variant={variant} 
        className={`mr-2 mb-2 w-auto ${getColorClass(children?.toString() || '')}`}
      >
        {(children?.toString() === 'In Progress' || 
          children?.toString() === 'Trending Up' || 
          children?.toString() === 'Growing Team') && <CheckCircle2 className="h-3 w-3" />}
        {(children?.toString() === 'High Priority' || 
          children?.toString() === 'High Impact' || 
          children?.toString() === 'Active Hiring') && <AlertCircle className="h-3 w-3" />}
        {children}
      </Badge>
    );
  },
  pre: ({ children }: React.DetailedHTMLProps<React.HTMLAttributes<HTMLPreElement>, HTMLPreElement>) => children,
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const language: string = className ? className.replace(/language-/, '') : 'typescript';
    // Convert ReactNode to string for the Highlight component
    const codeString: string = typeof children === 'string' ? children : String(children ?? '');

    return (
      <Highlight
        theme={themes.nightOwl}
        code={codeString.trim()}
        language={language}
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          // Night Owl's editor background. A code block carries its own syntax
          // palette, deliberately independent of the UI theme: the token colours
          // inside it are tuned against THIS background, so bg-card would break
          // their contrast.
          // eslint-disable-next-line no-restricted-syntax
          <pre className="p-4 rounded-lg overflow-x-auto bg-[#011627] my-4">
            <code className={className} style={style}>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    );
  },
  Table: Table,
  // A Citadel app's zone: a placeholder until the runtime can run it (app-zone/AppZone.tsx).
  AppZone: AppZone,
};