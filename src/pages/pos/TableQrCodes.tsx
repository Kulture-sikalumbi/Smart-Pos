import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageComponents';
import { generateQrDataUrl } from '@/lib/qr';
import { useRestaurantTables } from '@/hooks/useRestaurantTables';

export default function TableQrCodes() {
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const { sections } = useRestaurantTables();
  const tables = useMemo(() => sections.flatMap((s) => s.tables), [sections]);

  const baseUrl = useMemo(() => {
    // For demo we use current origin. In production you would set this in Settings.
    return window.location.origin;
  }, []);

  useEffect(() => {
    const run = async () => {
      const next: Record<string, string> = {};
      for (const t of tables) {
        const url = `${baseUrl}/self-order/${t.number}`;
        next[t.id] = await generateQrDataUrl(url);
      }
      setQrs(next);
    };

    void run();
  }, [baseUrl]);

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Table Self-Order QR" description="Print these QR codes and place them on tables." />

      <Card className="p-4 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Table</TableHead>
              <TableHead>QR</TableHead>
              <TableHead>Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tables.map(t => {
              const url = `${baseUrl}/self-order/${t.number}`;
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-semibold">{t.number}</TableCell>
                  <TableCell>
                    {qrs[t.id] ? <img src={qrs[t.id]} alt={`QR ${t.number}`} className="w-24 h-24" /> : '…'}
                  </TableCell>
                  <TableCell className="text-sm">
                    <a className="underline" href={url} target="_blank" rel="noreferrer">{url}</a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="text-sm text-muted-foreground">
        Tip: Use the "Link" column to test on your phone.
      </div>
    </div>
  );
}
