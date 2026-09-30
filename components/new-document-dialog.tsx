"use client";

import { FileUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DocumentUploadForm } from "@/components/document-upload-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDocumentTree } from "@/lib/hooks/use-document-tree";

export function NewDocumentDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const tree = useDocumentTree();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8">
            <Plus className="size-3.5" />
            <span>New document</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl rounded-xl p-5 border-border/80 shadow-md">
        <DialogHeader className="space-y-1 pb-1">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-muted text-foreground border border-border/70">
              <FileUp className="size-3.5" />
            </div>
            <DialogTitle className="text-base font-semibold tracking-tight">Upload document</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Upload Markdown or HTML with any referenced image assets.
          </DialogDescription>
        </DialogHeader>

        <DocumentUploadForm
          onCancel={() => setOpen(false)}
          onSuccess={(id) => {
            setOpen(false);
            tree.reload();
            router.push(`/documents/${id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
