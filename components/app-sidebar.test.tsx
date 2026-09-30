/* eslint-disable @next/next/no-img-element */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/ui/avatar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/avatar")>();
  return {
    ...actual,
    AvatarImage: ({ src, alt, referrerPolicy, className }: { src?: string; alt?: string; referrerPolicy?: string; className?: string }) => (
      <img src={src} alt={alt} referrerPolicy={referrerPolicy as React.HTMLAttributeReferrerPolicy} className={className} />
    ),
  };
});

import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DocumentTreeProvider } from "@/lib/hooks/use-document-tree";

const dummyTreePage = {
  parentPath: "/",
  cursor: null,
  nextCursor: null,
  entries: [],
};

describe("AppSidebar Avatar", () => {
  it("renders profile image when user.image is provided", () => {
    const userWithImage = {
      name: "Jane Doe",
      email: "jane@example.com",
      image: "https://example.com/avatar.png",
    };

    const html = renderToStaticMarkup(
      <DocumentTreeProvider initialPage={dummyTreePage}>
        <SidebarProvider>
          <AppSidebar user={userWithImage} />
        </SidebarProvider>
      </DocumentTreeProvider>,
    );

    expect(html).toContain('src="https://example.com/avatar.png"');
    expect(html).toContain("no-referrer");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("JA");
  });

  it("renders initials fallback without image when user.image is not provided", () => {
    const userWithoutImage = {
      name: "Alex Smith",
      email: "alex@example.com",
    };

    const html = renderToStaticMarkup(
      <DocumentTreeProvider initialPage={dummyTreePage}>
        <SidebarProvider>
          <AppSidebar user={userWithoutImage} />
        </SidebarProvider>
      </DocumentTreeProvider>,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("Alex Smith");
    expect(html).toContain("AL");
  });
});
