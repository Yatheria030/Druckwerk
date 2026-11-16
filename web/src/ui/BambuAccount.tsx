// Bambu-Konto für MakerWorld: Anmeldung mit E-Mail und Passwort (oder nur Code per Mail), danach Code aus der Mail.
// Der Server schickt das Passwort einmal an Bambu und speichert nur das Token.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogOut, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type BambuAccount } from "../api.ts";
import { Button } from "./controls.tsx";

export const useBambuAccount = () => useQuery({ queryKey: ["bambu-account"], queryFn: api.bambuAccount, staleTime: 10_000 });

export function BambuAccountForm() {
  const qc = useQueryClient();
  const acc = useBambuAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"login" | "code" | "tfa">("login");
  const [error, setError] = useState("");
  const set = (a: BambuAccount) => {
    qc.setQueryData(["bambu-account"], a);
    void qc.invalidateQueries({ queryKey: ["makerworld-model"] });
    setPassword("");
    setCode("");
    setStep("login");
  };

  const login = useMutation({
    mutationFn: () => api.bambuLogin(email.trim(), password),
    onMutate: () => setError(""),
    onSuccess: (r) => (r.step === "done" ? set(r.account) : (setStep(r.step), setPassword(""))),
    onError: (e) => setError((e as Error).message),
  });
  const confirm = useMutation({
    mutationFn: () => api.bambuCode(code.trim()),
    onMutate: () => setError(""),
    onSuccess: set,
    onError: (e) => setError((e as Error).message),
  });
  const logout = useMutation({ mutationFn: api.bambuLogout, onSuccess: (a) => qc.setQueryData(["bambu-account"], a) });

  const a = acc.data;
  // Abgelaufen: E-Mail vorbelegen
  useEffect(() => {
    if (a?.expired && a.email) setEmail((e) => e || a.email);
  }, [a?.expired, a?.email]);
  if (a?.logged_in && step === "login")
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-fill px-4 py-3">
        {a.avatar ? (
          <img src={a.avatar} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <CheckCircle2 size={22} className="shrink-0 text-good" />
        )}
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate font-semibold">{a.name || a.email}</div>
          <div className="text-xs leading-relaxed break-words text-ink3">
            {a.name ? `${a.email} · ` : ""}angemeldet{a.expires ? `, gültig bis ${new Date(a.expires).toLocaleDateString("de-DE")}, verlängert sich selbst` : ""}
          </div>
        </div>
        <Button busy={logout.isPending} onClick={() => logout.mutate()}>
          <LogOut size={15} /> Abmelden
        </Button>
      </div>
    );

  return (
    <div className="space-y-3">
      {a?.expired && step === "login" && (
        <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent">Die Anmeldung von {a.email} ist abgelaufen. Bitte neu anmelden.</p>
      )}
      {step === "login" ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-bold tracking-[0.08em] text-ink3 uppercase">E-Mail</span>
            <input
              className="field h-10 rounded-lg bg-fill px-3"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Passwort</span>
            <input
              className="field h-10 rounded-lg bg-fill px-3"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="leer = Code per Mail"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button kind="primary" busy={login.isPending} disabled={!email.trim()}>
              {password ? "Anmelden" : (
                <>
                  <Mail size={15} /> Code per Mail
                </>
              )}
            </Button>
            {error && <span className="text-sm text-bad">{error}</span>}
          </div>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate();
          }}
        >
          <p className="text-sm text-ink2">
            {step === "code"
              ? `Bambu hat einen Code an ${email} geschickt. Er gilt ein paar Minuten.`
              : "Dein Konto hat Zwei-Faktor-Anmeldung: Code aus der Authenticator-App eingeben."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="field h-10 w-40 rounded-lg bg-fill px-3 text-center font-mono text-lg tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-label="Code"
            />
            <Button kind="primary" busy={confirm.isPending} disabled={code.length < 4}>
              Bestätigen
            </Button>
            <Button type="button" onClick={() => (setStep("login"), setError(""))}>
              Zurück
            </Button>
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
        </form>
      )}
      <p className="text-xs leading-relaxed text-ink3">
        Das Passwort geht einmal an Bambu und wird nicht gespeichert. Druckwerk behält nur das Token und nutzt es ausschließlich, um bei MakerWorld Dateien zu
        laden. Die Drucker bleiben im Heimnetz, ohne Bambu-Cloud.
      </p>
    </div>
  );
}
