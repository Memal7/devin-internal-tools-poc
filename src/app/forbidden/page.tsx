import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">403: Not allowed</h1>
        <p className="mt-2 text-sm text-slate-600">Your roles do not grant access to this page.</p>
        <div className="mt-4 flex justify-center gap-4 text-sm">
          <Link href="/" className="text-sky-700 hover:underline">
            Home
          </Link>
          <Link href="/login" className="text-sky-700 hover:underline">
            Sign in as someone else
          </Link>
        </div>
      </div>
    </main>
  );
}
