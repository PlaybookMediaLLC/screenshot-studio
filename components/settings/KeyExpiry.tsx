import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Explicit durations shared by API and agent keys. */
export function KeyExpiry({ id }: { id: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Expires in</Label>
      <Select name="expiresInDays" defaultValue="30">
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[7, 30, 90, 365].map((days) => (
            <SelectItem key={days} value={String(days)}>
              {days} days
            </SelectItem>
          ))}
          <SelectItem value="never">No expiry</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Measured from the day you create the key.</p>
    </div>
  )
}
