import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

/**
 * Guards the local patch in sidebar.tsx. Tailwind's `data-active:` variant
 * matches on attribute presence, so React must omit the attribute for inactive
 * rows — rendering it as "false" would style the whole sidebar as selected.
 * Re-running `shadcn add sidebar --overwrite` reintroduces the bug.
 */
describe("SidebarMenuButton", () => {
  it("marks only the active row with a data-active attribute", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={false}>Inactive</SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>Active</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>,
    );

    expect(html).not.toContain('data-active="false"');
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
  });
});
