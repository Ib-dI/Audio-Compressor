import AudioCompressor from "@/components/AudioCompressor";


export default function Home() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between md:py-6 py-4 md:px-4 bg-white dark:bg-black sm:items-start">
        <AudioCompressor />
      </main>
    </div>
  );
}
