import { MDXProvider } from '@mdx-js/react';
import { compile } from '@mdx-js/mdx';
import * as runtime from 'react/jsx-runtime';
import { evaluate } from '@mdx-js/mdx';
import { Highlight, themes } from "prism-react-renderer";
import Table from '../Table';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertCircle } from "lucide-react";

export const components = {
  h1: ({ children }) => (
    <h1 className="text-4xl font-bold mb-4 text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-2xl font-semibold mb-3 text-white">{children}</h2>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-gray-300">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-4 text-gray-300">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="mb-2">{children}</li>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-purple-400 hover:text-purple-300 underline">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt} className="max-w-full h-auto rounded-lg shadow-lg my-4" />
  ),
  table: ({ children, ...props }) => (
    <div className="my-6 w-full overflow-y-auto">
      <Table {...props} className="w-full border border-gray-800">
        {children}
      </Table>
    </div>
  ),
  thead: TableHeader,
  tbody: TableBody,
  tr: ({ children, ...props }) => (
    <TableRow {...props} className="hover:bg-[#E5DEFF]/10 transition-colors">
      {children}
    </TableRow>
  ),
  th: ({ children, ...props }) => (
    <TableHead {...props} className="border-b border-gray-800 bg-gray-900/50 text-white font-medium p-4">
      {children}
    </TableHead>
  ),
  td: ({ children, ...props }) => (
    <TableCell {...props} className="border-b border-gray-800 text-gray-300 p-4">
      {children}
    </TableCell>
  ),
  Card: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
    <Card className="bg-[#343A5C] border-gray-700 mb-6">
      <CardHeader>
        <CardTitle className="text-white">{title}</CardTitle>
        {description && <CardDescription className="text-gray-300">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="text-gray-300">{children}</CardContent>
    </Card>
  ),
  Alert: ({ title, children, variant = "default" }: { title: string; children: React.ReactNode; variant?: "default" | "destructive" }) => (
    <Alert variant={variant} className="mb-6 bg-[#343A5C] border-purple-800">
      <AlertTitle className="text-white">{title}</AlertTitle>
      <AlertDescription className="text-gray-300">{children}</AlertDescription>
    </Alert>
  ),
  Badge: ({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "secondary" | "destructive" | "outline" }) => {
    const getColorClass = (text: string) => {
      if (text === 'In Progress' || text === 'Trending Up' || text === 'Growing Team') 
        return 'text-emerald-800 flex items-center gap-1 inline-flex';
      if (text === 'High Priority' || text === 'High Impact' || text === 'Active Hiring') 
        return 'text-red-600 flex items-center gap-1 inline-flex';
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
  pre: ({ children }: { children: any }) => children,
  code: ({ children, className }: { children: string; className?: string }) => {
    const language = className ? className.replace(/language-/, '') : 'typescript';
    
    return (
      <Highlight
        theme={themes.nightOwl}
        code={children.trim()}
        language={language}
      >
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
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
};