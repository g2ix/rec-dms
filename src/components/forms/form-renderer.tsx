"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, type SaveState } from "@/components/ui/field";
import { Radio } from "@/components/ui/radio";
import { Textarea } from "@/components/ui/textarea";
import { formatBoundValue } from "@/lib/forms/bindings";
import { canChangeRepeatingRows, getEditableFields, isRepeatingColumnEditable } from "@/lib/forms/editable";
import { centavosFromPesos, formatCentavos, pesosInput } from "@/lib/forms/money";
import { isSectionVisible } from "@/lib/forms/logic";
import { getPath, setPath } from "@/lib/forms/paths";
import { computedText } from "@/lib/forms/recompute";
import type { RoleKey } from "@/lib/forms/roles";
import type { ColumnType, FormColumn, FormField, FormSchema } from "@/lib/forms/schema";
import type { SignatureSlotView, SigningPrompt } from "@/lib/signatures/view";
import { SignatureFields } from "@/components/forms/signature-field";

export type FormMode = "edit" | "view" | "print";

export type FieldUi = {
  state?: SaveState;
  message?: string;
  error?: string;
};

type Row = Record<string, unknown>;

export function FormRenderer({
  schema,
  data,
  mode,
  roles,
  stepKey,
  onChange,
  fieldState,
  boundValues = {},
  onUseTheirs,
  onKeepMine,
  signatureSlots,
  signing = null,
  allowedRows,
}: {
  schema: FormSchema;
  data: Record<string, unknown>;
  mode: FormMode;
  roles: RoleKey[];
  stepKey: string | null;
  onChange?: (path: string, value: unknown) => void;
  fieldState?: Record<string, FieldUi>;
  boundValues?: Record<string, unknown>;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
  signatureSlots?: Record<string, SignatureSlotView[]>;
  signing?: SigningPrompt | null;
  allowedRows?: Record<string, readonly string[]>;
}) {
  const editable = getEditableFields(
    { schema },
    { status: mode === "edit" ? "DRAFT" : "LOCKED", data },
    { id: "renderer" },
    roles,
    stepKey,
    allowedRows,
  );
  const editing = mode === "edit";
  const sections = schema.sections.filter((section) => isSectionVisible(section, data));

  return (
    <div className={mode === "print" ? "rec-stack rec-form--print" : "rec-stack"}>
      {sections.length === 0 ? <p className="body rec-muted">Nothing in this form applies to the current answers.</p> : null}
      {sections.map((section) => (
        <section key={section.id} className="rec-card rec-form-section" aria-labelledby={`section-${section.id}`}>
          <h2 id={`section-${section.id}`} className="heading">
            {section.title}
          </h2>
          {section.description ? <p className="body-sm rec-muted">{section.description}</p> : null}
          {section.fields.map((field) => (
            <FieldBlock
              key={field.id}
              schema={schema}
              field={field}
              data={data}
              editing={editing}
              editable={editable}
              onChange={onChange}
              fieldState={fieldState}
              boundValues={boundValues}
              onUseTheirs={onUseTheirs}
              onKeepMine={onKeepMine}
              signatureSlots={signatureSlots}
              signing={signing}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function FieldBlock(props: {
  schema: FormSchema;
  field: FormField;
  data: Record<string, unknown>;
  editing: boolean;
  editable: Set<string>;
  onChange?: (path: string, value: unknown) => void;
  fieldState?: Record<string, FieldUi>;
  boundValues: Record<string, unknown>;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
  signatureSlots?: Record<string, SignatureSlotView[]>;
  signing?: SigningPrompt | null;
}) {
  const { field, data, boundValues } = props;
  if (field.type === "staticText") {
    return (
      <div className="rec-field rec-field--wide">
        <p className="body">{field.label}</p>
        {field.help ? <p className="rec-field__help">{field.help}</p> : null}
      </div>
    );
  }
  if (field.type === "signature") {
    return <SignatureFields field={field} slots={props.signatureSlots?.[field.id] ?? []} signing={props.signing ?? null} />;
  }
  if (field.type === "fileRef") {
    return (
      <div className="rec-field">
        <p className="label">{field.label}</p>
        <p className="rec-field__help">Files are attached with the protocol uploads.</p>
      </div>
    );
  }
  if (field.type === "computed") {
    return (
      <Field label={field.label} help={field.help ?? "Calculated"}>
        <input className="rec-input" readOnly value={computedText(props.schema, field, data)} />
      </Field>
    );
  }
  if (field.bind) {
    return (
      <Field label={field.label} help={field.help} locked lockedHref="/app/protocols">
        {formatBoundValue(boundValues[field.bind])}
      </Field>
    );
  }
  if (field.type === "repeatingTable") return <RepeatingTable {...props} />;
  if (field.type === "assessmentTable") return <AssessmentTable {...props} />;
  if (field.type === "declaration") return <Declaration {...props} />;
  return <ScalarField {...props} />;
}

function notice(fieldState: Record<string, FieldUi> | undefined, path: string): FieldUi | undefined {
  return fieldState?.[path];
}

function ResolveButtons({
  path,
  ui,
  onUseTheirs,
  onKeepMine,
}: {
  path: string;
  ui?: FieldUi;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
}) {
  if (ui?.state !== "conflict") return null;
  return (
    <div className="rec-actions">
      <Button type="button" onClick={() => onUseTheirs?.(path)}>
        Use their value
      </Button>
      <Button type="button" variant="primary" onClick={() => onKeepMine?.(path)}>
        Keep mine
      </Button>
    </div>
  );
}

function ScalarField({
  field,
  data,
  editing,
  editable,
  onChange,
  fieldState,
  onUseTheirs,
  onKeepMine,
}: {
  field: FormField;
  data: Record<string, unknown>;
  editing: boolean;
  editable: Set<string>;
  onChange?: (path: string, value: unknown) => void;
  fieldState?: Record<string, FieldUi>;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
}) {
  const readOnly = !editing || !editable.has(field.id);
  const ui = notice(fieldState, field.id);
  const labelId = `${field.id}-label`;
  return (
    <>
      <Field
        label={field.label}
        help={field.help}
        optional={!field.validation?.required}
        htmlFor={field.type === "yesNoNa" || field.type === "radio" || field.type === "checkboxes" ? undefined : field.id}
        labelId={labelId}
        error={ui?.error}
        saveState={ui?.state ?? "idle"}
        conflict={ui?.message}
      >
        <Control
          id={field.id}
          labelId={labelId}
          type={field.type}
          value={data[field.id]}
          readOnly={readOnly}
          options={field.options}
          onChange={(value) => onChange?.(field.id, value)}
        />
      </Field>
      <ResolveButtons path={field.id} ui={ui} onUseTheirs={onUseTheirs} onKeepMine={onKeepMine} />
    </>
  );
}

function Declaration({
  field,
  data,
  editing,
  editable,
  onChange,
  fieldState,
  onUseTheirs,
  onKeepMine,
}: {
  field: FormField;
  data: Record<string, unknown>;
  editing: boolean;
  editable: Set<string>;
  onChange?: (path: string, value: unknown) => void;
  fieldState?: Record<string, FieldUi>;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
}) {
  const readOnly = !editing || !editable.has(field.id);
  const ui = notice(fieldState, field.id);
  return (
    <div className={ui?.error ? "rec-field rec-field--error" : "rec-field"}>
      <Checkbox
        label={field.label}
        checked={data[field.id] === true}
        disabled={readOnly}
        onChange={(event) => onChange?.(field.id, event.target.checked)}
      />
      {field.help ? <p className="rec-field__help">{field.help}</p> : null}
      {ui?.error ? (
        <p className="rec-field__error" role="alert">
          {ui.error}
        </p>
      ) : ui?.message || ui?.state === "saving" || ui?.state === "saved" ? (
        <p className={ui.state === "conflict" ? "rec-save rec-save--conflict" : "rec-save"} data-state={ui.state} role="status">
          {ui.state === "saving" ? "Saving…" : ui.state === "saved" ? "Saved" : ui.message}
        </p>
      ) : (
        <p className="rec-save" aria-hidden="true" />
      )}
      <ResolveButtons path={field.id} ui={ui} onUseTheirs={onUseTheirs} onKeepMine={onKeepMine} />
    </div>
  );
}

function Control({
  id,
  labelId,
  type,
  value,
  readOnly,
  options,
  onChange,
}: {
  id: string;
  labelId?: string;
  type: FormField["type"] | ColumnType;
  value: unknown;
  readOnly: boolean;
  options?: { value: string; label: string }[];
  onChange: (value: unknown) => void;
}) {
  if (type === "textarea" || type === "richtext") {
    return (
      <Textarea
        id={id}
        readOnly={readOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (type === "number") return <NumberControl id={id} value={value} readOnly={readOnly} onChange={onChange} />;
  if (type === "money") return <MoneyControl id={id} value={value} readOnly={readOnly} onChange={onChange} />;
  if (type === "date") {
    return (
      <input
        id={id}
        className="rec-input"
        type="date"
        readOnly={readOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  }
  if (type === "email" || type === "phone" || type === "text") {
    return (
      <input
        id={id}
        className="rec-input"
        type={type === "email" ? "email" : type === "phone" ? "tel" : "text"}
        readOnly={readOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (type === "select") {
    return (
      <select
        id={id}
        className="rec-select"
        disabled={readOnly}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Choose</option>
        {(options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (type === "radio" || type === "yesNoNa") {
    const choice = type === "yesNoNa" ? yesNo(value).choice : typeof value === "string" ? value : "";
    const group =
      type === "yesNoNa"
        ? [
            { value: "YES", label: "Yes" },
            { value: "NO", label: "No" },
            { value: "NA", label: "Not applicable" },
          ]
        : (options ?? []);
    return (
      <div className="rec-choice" role="radiogroup" aria-labelledby={labelId}>
        {group.map((option) => (
          <Radio
            key={option.value}
            name={id}
            value={option.value}
            label={option.label}
            checked={choice === option.value}
            disabled={readOnly}
            onChange={() => {
              if (type === "yesNoNa") onChange({ ...yesNo(value), choice: option.value });
              else onChange(option.value);
            }}
          />
        ))}
        {type === "yesNoNa" && choice === "NA" ? (
          <Textarea
            aria-label="Why this is not applicable"
            readOnly={readOnly}
            value={yesNo(value).reason}
            placeholder="Explain why this is not applicable"
            onChange={(event) => onChange({ choice: "NA", reason: event.target.value })}
          />
        ) : null}
      </div>
    );
  }
  if (type === "checkboxes") {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return (
      <div role="group" aria-labelledby={labelId} className="rec-choice">
        {(options ?? []).map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            disabled={readOnly}
            onChange={(event) => {
              const next = event.target.checked
                ? [...selected, option.value]
                : selected.filter((item) => item !== option.value);
              onChange(next);
            }}
          />
        ))}
      </div>
    );
  }
  return null;
}

function NumberControl({
  id,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  const numeric = typeof value === "number" ? value : null;
  const [text, setText] = useState(numeric == null ? "" : String(numeric));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(numeric == null ? "" : String(numeric));
  }, [numeric]);
  return (
    <input
      id={id}
      className="rec-input"
      inputMode="decimal"
      readOnly={readOnly}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setText(numeric == null ? "" : String(numeric));
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (!next.trim()) {
          onChange(null);
          return;
        }
        const parsed = Number(next);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}

function MoneyControl({
  id,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  value: unknown;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  const numeric = typeof value === "number" ? value : null;
  const [text, setText] = useState(numeric == null ? "" : pesosInput(numeric));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(numeric == null ? "" : pesosInput(numeric));
  }, [numeric]);
  return (
    <>
      <input
        id={id}
        className="rec-input"
        inputMode="decimal"
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-money` : undefined}
        value={text}
        placeholder="0.00"
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          if (numeric == null) setText("");
          else setText(pesosInput(numeric));
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const centavos = centavosFromPesos(next);
          if (centavos === null) {
            setInvalid(false);
            onChange(null);
            return;
          }
          if (!Number.isFinite(centavos)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onChange(centavos);
        }}
      />
      {invalid ? (
        <span id={`${id}-money`} className="rec-field__error">
          Enter an amount in pesos, such as 150.00.
        </span>
      ) : null}
    </>
  );
}

function yesNo(value: unknown): { choice: string; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { choice: "", reason: "" };
  const choice = (value as { choice?: unknown }).choice;
  const reason = (value as { reason?: unknown }).reason;
  return {
    choice: choice === "YES" || choice === "NO" || choice === "NA" ? choice : "",
    reason: typeof reason === "string" ? reason : "",
  };
}

function rowsOf(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function RepeatingTable({
  field,
  data,
  editing,
  editable,
  onChange,
  fieldState,
  onUseTheirs,
  onKeepMine,
}: {
  field: FormField;
  data: Record<string, unknown>;
  editing: boolean;
  editable: Set<string>;
  onChange?: (path: string, value: unknown) => void;
  fieldState?: Record<string, FieldUi>;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
}) {
  const rows = rowsOf(data[field.id]);
  const structure = editing && canChangeRepeatingRows(editable, field.id);
  const ui = notice(fieldState, field.id);
  const labelId = useId();

  function commitRows(next: Row[]) {
    onChange?.(field.id, next);
  }

  function commitCell(row: Row, column: FormColumn, value: unknown) {
    const rowId = String(row._rowId ?? "");
    if (structure) {
      commitRows(rows.map((item) => (item._rowId === row._rowId ? { ...item, [column.id]: value } : item)));
      return;
    }
    onChange?.(`${field.id}.${rowId}.${column.id}`, value);
  }

  return (
    <div className="rec-field rec-field--wide">
      <p className="rec-field__label" id={labelId}>
        {field.label}
        {!field.validation?.required ? <span className="rec-field__optional"> (optional)</span> : null}
      </p>
      {field.help ? <p className="rec-field__help">{field.help}</p> : null}
      <div className="rec-table-wrap">
        <table className="rec-table rec-assess" aria-labelledby={labelId}>
          <thead>
            <tr>
              {(field.columns ?? []).map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
              {structure ? <th scope="col">Order</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={(field.columns?.length ?? 1) + (structure ? 1 : 0)}>No rows yet.</td>
              </tr>
            ) : null}
            {rows.map((row, index) => (
              <tr key={String(row._rowId ?? index)}>
                {(field.columns ?? []).map((column) => {
                  const open = editing && isRepeatingColumnEditable(editable, field.id, column.id);
                  const cellPath = `${field.id}.${String(row._rowId ?? index)}.${column.id}`;
                  const cellUi = notice(fieldState, cellPath);
                  return (
                    <td key={column.id} className={open ? undefined : "rec-cell--locked"} data-label={column.label}>
                      <span className="rec-assess__label label">{column.label}</span>
                      {column.type === "computed" ? (
                        <span>{typeof row[column.id] === "number" ? formatCentavos(Math.round(row[column.id] as number)) : "0.00"}</span>
                      ) : (
                        <Control
                          id={cellPath}
                          type={column.type}
                          value={row[column.id]}
                          readOnly={!open}
                          options={column.options}
                          onChange={(value) => commitCell(row, column, value)}
                        />
                      )}
                      {cellUi?.error ? <p className="rec-field__error">{cellUi.error}</p> : null}
                      {cellUi?.state === "conflict" ? <p className="rec-save rec-save--conflict">{cellUi.message}</p> : null}
                      <ResolveButtons path={cellPath} ui={cellUi} onUseTheirs={onUseTheirs} onKeepMine={onKeepMine} />
                    </td>
                  );
                })}
                {structure ? (
                  <td>
                    <div className="rec-row-actions">
                      <Button type="button" disabled={index === 0} onClick={() => commitRows(move(rows, index, -1))}>
                        Move up
                      </Button>
                      <Button type="button" disabled={index === rows.length - 1} onClick={() => commitRows(move(rows, index, 1))}>
                        Move down
                      </Button>
                      <Button type="button" variant="danger" onClick={() => commitRows(rows.filter((_, rowIndex) => rowIndex !== index))}>
                        Remove
                      </Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {structure ? (
        <div className="rec-row-actions">
          <Button
            type="button"
            variant="primary"
            onClick={() =>
              commitRows([
                ...rows,
                { _rowId: crypto.randomUUID(), ...Object.fromEntries((field.columns ?? []).map((column) => [column.id, null])) },
              ])
            }
          >
            Add row
          </Button>
        </div>
      ) : null}
      {ui?.error ? (
        <p className="rec-field__error" role="alert">
          {ui.error}
        </p>
      ) : ui?.state === "saving" || ui?.state === "saved" || ui?.state === "conflict" ? (
        <p className={ui.state === "conflict" ? "rec-save rec-save--conflict" : "rec-save"} data-state={ui.state} role="status">
          {ui.state === "saving" ? "Saving…" : ui.state === "saved" ? "Saved" : ui.message}
        </p>
      ) : (
        <p className="rec-save" aria-hidden="true" />
      )}
      <ResolveButtons path={field.id} ui={ui} onUseTheirs={onUseTheirs} onKeepMine={onKeepMine} />
    </div>
  );
}

function move(rows: Row[], index: number, direction: -1 | 1): Row[] {
  const next = rows.slice();
  const target = index + direction;
  const current = next[index];
  const swap = next[target];
  if (!current || !swap) return rows;
  next[index] = swap;
  next[target] = current;
  return next;
}

function AssessmentTable({
  field,
  data,
  editing,
  editable,
  onChange,
  fieldState,
  onUseTheirs,
  onKeepMine,
}: {
  field: FormField;
  data: Record<string, unknown>;
  editing: boolean;
  editable: Set<string>;
  onChange?: (path: string, value: unknown) => void;
  fieldState?: Record<string, FieldUi>;
  onUseTheirs?: (path: string) => void;
  onKeepMine?: (path: string) => void;
}) {
  const table = data[field.id];
  const record = table && typeof table === "object" && !Array.isArray(table) ? (table as Record<string, unknown>) : {};
  const labelId = useId();
  return (
    <div className="rec-field rec-field--wide">
      <p className="rec-field__label" id={labelId}>
        {field.label}
      </p>
      {field.help ? <p className="rec-field__help">{field.help}</p> : null}
      <div className="rec-table-wrap">
        <table className="rec-table rec-assess" aria-labelledby={labelId}>
          <thead>
            <tr>
              <th scope="col">Point</th>
              {(field.columns ?? []).map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(field.rows ?? []).filter((row) => shownAssessmentRow(field, record[row.id])).map((row) => {
              const rowValue = record[row.id];
              const cells = rowValue && typeof rowValue === "object" && !Array.isArray(rowValue) ? (rowValue as Record<string, unknown>) : {};
              return (
                <tr key={row.id}>
                  <th scope="row">
                    <span className="code">{row.code}</span> {row.label}
                    {row.help ? <span className="rec-field__help">{row.help}</span> : null}
                  </th>
                  {(field.columns ?? []).map((column) => {
                    const path = `${field.id}.${row.id}.${column.id}`;
                    const open = editing && editable.has(path);
                    const ui = notice(fieldState, path);
                    return (
                      <td key={column.id} className={open ? undefined : "rec-cell--locked"} data-label={column.label}>
                        <span className="rec-assess__label label">{column.label}</span>
                        <Control
                          id={path}
                          type={column.type}
                          value={cells[column.id]}
                          readOnly={!open}
                          options={column.options}
                          onChange={(value) => onChange?.(path, value)}
                        />
                        {ui?.error ? <p className="rec-field__error">{ui.error}</p> : null}
                        {ui?.state === "saving" || ui?.state === "saved" || ui?.state === "conflict" ? (
                          <p className={ui.state === "conflict" ? "rec-save rec-save--conflict" : "rec-save"} data-state={ui.state} role="status">
                            {ui.state === "saving" ? "Saving…" : ui.state === "saved" ? "Saved" : ui.message}
                          </p>
                        ) : null}
                        <ResolveButtons path={path} ui={ui} onUseTheirs={onUseTheirs} onKeepMine={onKeepMine} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {field.showRowsWhenFilled && field.showRowsWhenFilled.length > 0 && (field.rows ?? []).every((row) => !shownAssessmentRow(field, record[row.id])) ? (
          <p className="body-sm rec-muted">No reviewer comments or suggestions were recorded for these points.</p>
        ) : null}
      </div>
    </div>
  );
}

function shownAssessmentRow(field: FormField, cells: unknown): boolean {
  const keys = field.showRowsWhenFilled;
  if (!keys || keys.length === 0) return true;
  const row = cells && typeof cells === "object" && !Array.isArray(cells) ? (cells as Record<string, unknown>) : {};
  return keys.some((key) => typeof row[key] === "string" && row[key].trim() !== "");
}

export function patchData(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  return setPath(data, path, value);
}

export function readData(data: unknown, path: string): unknown {
  return getPath(data, path);
}
