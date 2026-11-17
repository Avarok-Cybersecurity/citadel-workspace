/**
 * MDXToolbar sub-component for MDXEditor.
 * Renders the formatting toolbar with tooltip-wrapped buttons.
 */

import React from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link,
  Image,
  Heading1,
  Heading2,
  Heading3,
  Code,
  Quote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MDXToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onUnderline: () => void;
  onHeading: (level: number) => void;
  onList: (ordered: boolean) => void;
  onBlockquote: () => void;
  onCode: () => void;
  onLink: () => void;
  onImage: () => void;
}

interface ToolbarButton {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ToolbarDivider(): JSX.Element {
  return <div className="w-px h-6 bg-border mx-1" />;
}

export function MDXToolbar({
  onBold,
  onItalic,
  onUnderline,
  onHeading,
  onList,
  onBlockquote,
  onCode,
  onLink,
  onImage,
}: MDXToolbarProps): JSX.Element {
  const formatGroup: ToolbarButton[] = [
    { icon: <Bold className="h-4 w-4" />, label: 'Bold', onClick: onBold },
    { icon: <Italic className="h-4 w-4" />, label: 'Italic', onClick: onItalic },
    { icon: <Underline className="h-4 w-4" />, label: 'Underline', onClick: onUnderline },
  ];

  const headingGroup: ToolbarButton[] = [
    { icon: <Heading1 className="h-4 w-4" />, label: 'Heading 1', onClick: () => onHeading(1) },
    { icon: <Heading2 className="h-4 w-4" />, label: 'Heading 2', onClick: () => onHeading(2) },
    { icon: <Heading3 className="h-4 w-4" />, label: 'Heading 3', onClick: () => onHeading(3) },
  ];

  const listGroup: ToolbarButton[] = [
    { icon: <List className="h-4 w-4" />, label: 'Bullet List', onClick: () => onList(false) },
    { icon: <ListOrdered className="h-4 w-4" />, label: 'Numbered List', onClick: () => onList(true) },
  ];

  const blockGroup: ToolbarButton[] = [
    { icon: <Quote className="h-4 w-4" />, label: 'Blockquote', onClick: onBlockquote },
    { icon: <Code className="h-4 w-4" />, label: 'Inline Code', onClick: onCode },
  ];

  const insertGroup: ToolbarButton[] = [
    { icon: <Link className="h-4 w-4" />, label: 'Link', onClick: onLink },
    { icon: <Image className="h-4 w-4" />, label: 'Image', onClick: onImage },
  ];

  const renderGroup: (buttons: ToolbarButton[]) => JSX.Element[] = (buttons: ToolbarButton[]): JSX.Element[] =>
    buttons.map(({ icon, label, onClick }) => (
      <Tooltip key={label}>
        <TooltipTrigger asChild>
          {/*
            aria-label from the same `label` the tooltip shows. Without it these
            are twelve icon-only buttons whose name lives in a TooltipContent
            that is not rendered until hover, so a screen reader announces
            "button" twelve times and a keyboard user cannot tell them apart.
          */}
          <Button variant="ghost" size="icon" onClick={onClick} aria-label={label}>
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    ));

  return (
    <TooltipProvider>
      <div className="bg-card p-2 mb-2 rounded-t-md border-b border-border flex flex-wrap gap-1">
        {renderGroup(formatGroup)}
        <ToolbarDivider />
        {renderGroup(headingGroup)}
        <ToolbarDivider />
        {renderGroup(listGroup)}
        <ToolbarDivider />
        {renderGroup(blockGroup)}
        <ToolbarDivider />
        {renderGroup(insertGroup)}
      </div>
    </TooltipProvider>
  );
}
