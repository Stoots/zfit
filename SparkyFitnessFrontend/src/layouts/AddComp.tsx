import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AddCompItem {
  value: string;
  label: string;
  icon: LucideIcon;
  fullWidth?: boolean;
}

interface AddCompProps {
  isVisible: boolean;
  onClose: () => void;
  items: AddCompItem[];
  onNavigate: (value: string) => void;
  title?: string;
}

const AddComp: React.FC<AddCompProps> = ({
  isVisible,
  onClose,
  items,
  onNavigate,
  title,
}) => {
  const { t } = useTranslation();

  if (!isVisible) {
    return null;
  }

  const handleItemClick = (value: string) => {
    onNavigate(value);
    onClose();
  };

  //full width support
  const regularItems = items.filter((item) => !item.fullWidth);
  const fullWidthItems = items.filter((item) => item.fullWidth);

  return (
    <Dialog
      open={isVisible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title || t('addComp.addNew', 'Add New')}</DialogTitle>
        </DialogHeader>

        {/* Regular grid items */}
        {regularItems.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mt-4">
            {regularItems.map((item) => (
              <Button
                key={item.value}
                variant="outline"
                className="flex flex-col items-center justify-center h-auto min-h-16 whitespace-normal rounded-xl text-center bg-card text-card-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                onClick={() => handleItemClick(item.value)}
              >
                <item.icon className="h-6 w-6 mb-1" />
                <span className="text-sm font-semibold">{item.label}</span>
              </Button>
            ))}
          </div>
        )}

        {/* Full-width items */}
        {fullWidthItems.length > 0 && (
          <div className="flex flex-col gap-3 mt-4">
            {fullWidthItems.map((item) => (
              <Button
                key={item.value}
                variant="outline"
                className="flex items-center justify-center h-auto min-h-12 whitespace-normal w-full text-center bg-card text-card-foreground hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                onClick={() => handleItemClick(item.value)}
              >
                <item.icon className="h-6 w-6 mr-2" />
                <span className="text-base font-semibold">{item.label}</span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AddComp;
