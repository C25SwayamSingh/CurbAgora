export default function VendorPreviewLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl animate-pulse px-4 py-10 sm:py-16">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="mt-6 flex items-start gap-4">
        <div className="size-16 rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-6 h-16 w-full rounded bg-muted" />
    </main>
  );
}
