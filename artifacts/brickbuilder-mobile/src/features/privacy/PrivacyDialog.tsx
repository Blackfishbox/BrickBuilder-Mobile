import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function PrivacyDialog({ onClose }: { onClose(): void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl w-[calc(100%-24px)] p-3 sm:p-5" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Datenschutz · Android-Fassung</DialogTitle></DialogHeader>
      <iframe title="Datenschutzerklärung für BrickBuilder Mobile"
        src={`${import.meta.env.BASE_URL}privacy.html`}
        className="w-full rounded-md border-0 bg-white"
        style={{ height: "min(72dvh, 800px)" }} />
    </DialogContent>
  </Dialog>;
}
