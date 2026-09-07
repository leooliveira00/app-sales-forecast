import React from 'react';
import { cn } from './Common';

interface AvatarProps {
  nome: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-20 h-20 text-2xl',
};

export const Avatar: React.FC<AvatarProps> = ({ nome, avatarUrl, size = 'md', className }) => {
  const sizeClass = sizeMap[size];

  if (avatarUrl) {
    return (
      <div className={cn('rounded-full overflow-hidden shrink-0 bg-sky-100', sizeClass, className)}>
        <img
          src={avatarUrl}
          alt={nome}
          className="w-full h-full object-cover"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-full bg-sky-100 flex items-center justify-center text-[#1e3a5f] font-bold shrink-0',
      sizeClass,
      className,
    )}>
      {nome.charAt(0).toUpperCase()}
    </div>
  );
};
