"use client";

import { OpenStoredFileButton } from "@/components/docs/document-open";
import { formatManila } from "@/lib/time";

export type LogbookRow = {
  id: string;
  at: Date | string;
  kind: string;
  summary: string;
  actor: string;
  fileId?: string;
  fileMime?: string;
};

export function LogbookTable({
  protocolId,
  entries,
}: {
  protocolId: string;
  entries: LogbookRow[];
}) {
  return (
    <div className="rec-table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Kind</th>
            <th scope="col">What happened</th>
            <th scope="col">Who</th>
            <th scope="col">
              <span className="rec-sr">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const at = typeof entry.at === "string" ? new Date(entry.at) : entry.at;
            return (
              <tr key={entry.id}>
                <td>
                  <time dateTime={at.toISOString()}>{formatManila(at)}</time>
                </td>
                <td>{entry.kind}</td>
                <td>{entry.summary}</td>
                <td>{entry.actor}</td>
                <td>
                  {entry.fileId ? (
                    <OpenStoredFileButton
                      fileId={entry.fileId}
                      protocolId={protocolId}
                      label="Open"
                      variant="ghost"
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
