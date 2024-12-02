interface ConversationListProps {
  conversations: Array<{ id: string; preview: string }>;
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ conversations, activeId, onSelect }: ConversationListProps) {
  return (
    <div className="overflow-y-auto">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`w-full text-left p-4 hover:bg-gray-100 transition-colors ${
            activeId === conv.id ? 'bg-gray-100' : ''
          }`}
        >
          <p className="text-sm text-gray-900 truncate">{conv.preview}</p>
        </button>
      ))}
    </div>
  );
} 