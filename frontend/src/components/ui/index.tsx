import React from "react";
import { Info, WarningCircle } from "@phosphor-icons/react";
import type { Tone } from "../../lib/status";

const toneClass: Record<Tone, string> = {
  active: "status-active",
  degraded: "status-degraded",
  down: "status-down",
  critical: "status-critical",
  muted: "status-muted",
};

const chipClass: Record<Tone, string> = {
  active: "chip chip-active",
  degraded: "chip chip-degraded",
  down: "chip chip-down",
  critical: "chip chip-critical",
  muted: "chip",
};

export function StatusLabel({
  tone = "muted",
  children,
  dot = true,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`status ${toneClass[tone]}`} title={title}>
      {dot ? <span className="status-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Chip({
  tone = "muted",
  children,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={chipClass[tone]} title={title}>
      {children}
    </span>
  );
}

export function Meter({
  value,
  max,
  level = "ok",
  label,
}: {
  value: number;
  max: number;
  level?: "ok" | "warn" | "crit";
  label: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(ratio * 100)} percent`}
    >
      <div className="meter-fill" data-level={level === "ok" ? undefined : level} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Notice({
  tone = "muted",
  title,
  children,
}: {
  tone?: "error" | "warn" | "info" | "muted";
  title?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const className =
    tone === "error" ? "notice notice-error" : tone === "warn" ? "notice notice-warn" : tone === "info" ? "notice notice-info" : "notice";
  const Glyph = tone === "error" || tone === "warn" ? WarningCircle : Info;
  return (
    <div className={className} role={tone === "error" ? "alert" : "status"}>
      <Glyph aria-hidden="true" />
      <div className="stack-sm" style={{ gap: 2 }}>
        {title ? <strong style={{ fontSize: "var(--text-sm)" }}>{title}</strong> : null}
        {children ? <div style={{ fontSize: "var(--text-sm)" }}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty-art" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="empty-title">{title}</p>
      {body ? <p className="empty-body">{body}</p> : null}
      {action ? <div className="row" style={{ marginTop: "var(--space-2)" }}>{action}</div> : null}
    </div>
  );
}

export function KeyValues({ items }: { items: Array<{ label: React.ReactNode; value: React.ReactNode }> }) {
  return (
    <dl className="kv">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <dt className="kv-key">{item.label}</dt>
          <dd className="kv-val" style={{ margin: 0 }}>
            {item.value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
