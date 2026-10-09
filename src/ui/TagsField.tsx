// Tag editor: chips for active tags with remove buttons, a text input for typing new tags
// (comma or enter to add), and suggested chips for existing tags.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Chip } from './components';
import { TextField } from './TextField';
import { useTheme } from './theme';
import { splitTags } from '../transactions/tags';

export function TagsField({
  tags,
  onChange,
  suggestions = [],
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [input, setInput] = useState('');

  const addTag = (newTag: string) => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!tags.some((t) => t.toLowerCase() === key)) {
      onChange([...tags, trimmed]);
    }
  };

  const addMultiple = (text: string) => {
    const parsed = splitTags(text);
    if (parsed.length === 0) return;
    const existing = new Set(tags.map((t) => t.toLowerCase()));
    const toAdd = parsed.filter((p) => !existing.has(p.toLowerCase()));
    if (toAdd.length > 0) {
      onChange([...tags, ...toAdd]);
    }
  };

  const removeTag = (tagToRemove: string) => {
    const key = tagToRemove.toLowerCase();
    onChange(tags.filter((t) => t.toLowerCase() !== key));
  };

  const handleTextChange = (text: string) => {
    if (text.includes(',')) {
      addMultiple(text);
      setInput('');
    } else {
      setInput(text);
    }
  };

  const handleCommit = (text: string) => {
    if (text.trim()) {
      addMultiple(text);
      setInput('');
    }
  };

  const currentLower = new Set(tags.map((t) => t.toLowerCase()));
  const availableSuggestions = suggestions.filter((s) => !currentLower.has(s.toLowerCase()));

  return (
    <View style={{ gap: t.space.sm }}>
      {tags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              selected
              onRemove={() => removeTag(tag)}
              accessibilityLabel={tr('fields.removeTag', { tag })}
            />
          ))}
        </View>
      )}

      <TextField
        placeholder={placeholder ?? tr('fields.tagsPlaceholder')}
        value={input}
        onChangeText={handleTextChange}
        onBlur={() => handleCommit(input)}
        onSubmitEditing={() => handleCommit(input)}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />

      {availableSuggestions.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {availableSuggestions.map((suggestion) => (
            <Chip
              key={suggestion}
              label={`+ ${suggestion}`}
              onPress={() => addTag(suggestion)}
              accessibilityLabel={tr('fields.addTag', { tag: suggestion })}
            />
          ))}
        </View>
      )}
    </View>
  );
}
