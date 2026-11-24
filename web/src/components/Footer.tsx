export default function Footer() {
  return (
    <footer className="border-t border-hull-800/60 px-4 py-5 text-center text-[11px] leading-relaxed text-hull-600">
      <p className="mx-auto max-w-3xl">
        <span className="font-display text-hull-400">Nexus Nook</span> is an unofficial,
        fan-made app, not affiliated with or endorsed by Cloud Imperium Games. Star
        Citizen&reg; is a registered trademark of Cloud Imperium Rights LLC.
      </p>
      <p className="mt-1.5">
        &copy; 2026 Cole Houston. All Rights Reserved. ·{' '}
        <a href="#/privacy" className="underline hover:text-hull-400">
          Privacy Policy
        </a>
      </p>
    </footer>
  )
}
