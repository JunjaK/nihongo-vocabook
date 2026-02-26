import { useState, useCallback } from 'react';

/**
 * Dual-state search hook: `searchInput` is bound to the input,
 * `appliedQuery` triggers actual filtering on Enter/button click.
 */
export function useSearch() {
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  const handleSearch = useCallback(() => {
    setAppliedQuery(searchInput.trim());
  }, [searchInput]);

  const handleSearchClear = useCallback(() => {
    setSearchInput('');
    setAppliedQuery('');
  }, []);

  return { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear };
}
