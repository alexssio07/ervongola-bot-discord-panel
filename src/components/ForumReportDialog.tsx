import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import type { ForumReport, ForumReportRow, MovieStatus } from "../api/movies";

const STATUS_LABEL: Record<MovieStatus, string> = { visto: "visto", da_guardare: "da guardare" };

interface Props {
  report: ForumReport | null;
  onClose: () => void;
}

function Section({
  title,
  count,
  color,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  color: "default" | "warning" | "info" | "success";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Accordion defaultExpanded={defaultOpen} disableGutters variant="outlined" sx={{ mb: 1 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          <Chip size="small" label={count} color={color} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

/** Riga "post del forum → film del catalogo" con eventuale somiglianza. */
function RowLine({ row }: { row: ForumReportRow }) {
  const best = row.matches[0];
  return (
    <Box sx={{ py: 0.75, borderBottom: 1, borderColor: "divider" }}>
      <Typography sx={{ fontWeight: 600 }}>
        «{row.title}»
        {row.from_multi && (
          <Typography component="span" variant="body2" color="text.secondary">
            {" "}
            (dal post «{row.post}»)
          </Typography>
        )}
        <Typography component="span" variant="body2" color="text.secondary">
          {" "}
          · nel forum: {STATUS_LABEL[row.forum_status]}
          {row.tags.length > 0 ? ` (${row.tags.join(", ")})` : ""}
        </Typography>
      </Typography>
      {row.kind === "simile" &&
        row.matches.map((m) => (
          <Typography key={m.id} variant="body2" sx={{ pl: 2 }}>
            ≈ nel catalogo: <strong>«{m.title}»</strong> ({Math.round(m.score * 100)}% simile, {STATUS_LABEL[m.status]})
          </Typography>
        ))}
      {row.kind === "uguale" && best && row.status_differs && (
        <Typography variant="body2" color="warning.main" sx={{ pl: 2 }}>
          Nel catalogo è «{STATUS_LABEL[best.status]}», nel forum «{STATUS_LABEL[row.forum_status]}»
        </Typography>
      )}
    </Box>
  );
}

export default function ForumReportDialog({ report, onClose }: Props) {
  const rows = report?.rows ?? [];
  const similar = rows.filter((r) => r.kind === "simile");
  const nuovi = rows.filter((r) => r.kind === "nuovo");
  const uguali = rows.filter((r) => r.kind === "uguale");
  const statusDiff = rows.filter((r) => r.kind !== "nuovo" && r.status_differs);

  return (
    <Dialog open={report !== null} onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle sx={{ pr: 6 }}>
        Report forum ↔ film
        <IconButton aria-label="Chiudi" onClick={onClose} sx={{ position: "absolute", right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {report && (
          <>
            <Typography sx={{ mb: 1 }}>
              Solo lettura: non è stato importato né modificato nulla. Post nel forum: <strong>{report.total_threads}</strong>.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <Chip label={`Già nel catalogo: ${uguali.length}`} color="success" />
              <Chip label={`Titoli simili: ${similar.length}`} color="warning" />
              <Chip label={`Non presenti: ${nuovi.length}`} color="info" />
              <Chip label={`Stato diverso: ${statusDiff.length}`} color={statusDiff.length ? "warning" : "default"} />
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Tag del forum e stato che gli viene attribuito:{" "}
              {Object.entries(report.tags)
                .map(([name, st]) => `${name} → ${STATUS_LABEL[st]}`)
                .join(", ") || "nessun tag"}
              .
            </Typography>

            <Section title="Titoli simili (scritti in modo un po' diverso: da controllare)" count={similar.length} color="warning" defaultOpen>
              {similar.map((r, i) => (
                <RowLine key={`s${i}`} row={r} />
              ))}
            </Section>
            <Section title="Stato diverso fra forum e catalogo" count={statusDiff.length} color="warning" defaultOpen>
              {statusDiff.map((r, i) => (
                <RowLine key={`d${i}`} row={r} />
              ))}
            </Section>
            <Section title="Nel forum ma non nel catalogo" count={nuovi.length} color="info" defaultOpen>
              {nuovi.map((r, i) => (
                <RowLine key={`n${i}`} row={r} />
              ))}
            </Section>
            <Section title="Nel catalogo ma senza post nel forum" count={report.missing_in_forum_total} color="default">
              <Typography variant="body2">
                {report.missing_in_forum.join(" · ")}
                {report.missing_in_forum_total > report.missing_in_forum.length ? " …" : ""}
              </Typography>
            </Section>
            <Section title="Già presenti (stesso titolo)" count={uguali.length} color="success">
              {uguali.map((r, i) => (
                <RowLine key={`u${i}`} row={r} />
              ))}
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
