import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * One set of menu parts, so a list of items can be written once and rendered
 * into either kind of menu.
 *
 * Radix has no shared menu component: a dropdown's items must be
 * `DropdownMenu*` and a context menu's must be `ContextMenu*`, even though the
 * two render the same element and take the same props for everything used
 * here. A caller passes the set that matches the menu it is inside, and the
 * items themselves never know which one they are in.
 *
 * In its own file because it exports no components, and a module that mixes
 * components with constants loses Fast Refresh for the components.
 */
export type MenuKit = {
  Item: typeof DropdownMenuItem;
  Separator: typeof DropdownMenuSeparator;
  Sub: typeof DropdownMenuSub;
  SubTrigger: typeof DropdownMenuSubTrigger;
  SubContent: typeof DropdownMenuSubContent;
};

export const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export const CONTEXT_KIT: MenuKit = {
  // The two menus' items take the same props for everything used here, and the
  // rendered element is the same one. The cast is the price of Radix giving
  // them separate types rather than a shared primitive.
  Item: ContextMenuItem as unknown as MenuKit['Item'],
  Separator: ContextMenuSeparator as unknown as MenuKit['Separator'],
  Sub: ContextMenuSub as unknown as MenuKit['Sub'],
  SubTrigger: ContextMenuSubTrigger as unknown as MenuKit['SubTrigger'],
  SubContent: ContextMenuSubContent as unknown as MenuKit['SubContent'],
};
