import React from 'react';
import { Drawer } from 'vaul';

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onOpenChange, title, children }: BottomSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Drawer.Content className="fixed bottom-0 inset-x-0 z-50 bg-lumos-surface rounded-t-2xl max-h-[90vh] flex flex-col outline-none border-t border-lumos-border/50">
          <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-lumos-border" />
          {title && <Drawer.Title className="text-lg font-bold px-6 pt-4 text-lumos-text-primary">{title}</Drawer.Title>}
          <div className="overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
