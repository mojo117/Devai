import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizableDividerProps {
  onResize: (deltaX: number) => void;
}

export function ResizableDivider({ onResize }: ResizableDividerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      startXRef.current = e.clientX;
      onResize(deltaX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Change cursor globally while dragging
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, onResize]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`
        w-1 cursor-col-resize flex-shrink-0
        bg-gray-700 hover:bg-blue-500 transition-colors
        ${isDragging ? 'bg-blue-500' : ''}
      `}
      title="Drag to resize"
    >
      {/* Visual indicator */}
      <div className="h-full w-full flex items-center justify-center">
        <div className={`
          w-0.5 h-8 rounded-full
          ${isDragging ? 'bg-blue-300' : 'bg-gray-500'}
          transition-colors
        `} />
      </div>
    </div>
  );
}
