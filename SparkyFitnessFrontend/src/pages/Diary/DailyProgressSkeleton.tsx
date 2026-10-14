import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
export const DailyProgressSkeleton = () => (
  <Card className="rounded-3xl">
    <CardContent className="space-y-4 p-5 sm:p-6">
      <Skeleton className="h-20 w-48" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-56 max-w-full" />
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-11 w-full" />
    </CardContent>
  </Card>
);
