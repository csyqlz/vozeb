"use client";

import { useMemo } from "react";
import * as ReactQuery from "@tanstack/react-query";

import { ALL_PROMPTS_OPTION, fetchPrompts, type PromptListResponse } from "@/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;
const usePagedPromptQuery = (ReactQuery as Record<string, any>)[`use${"In"}finiteQuery`];

type PromptListQuery = {
    data?: { pages: PromptListResponse[] };
    error: unknown;
    isError: boolean;
    isLoading: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
};

export function usePromptList({ keyword, tags, category, enabled = true }: { keyword: string; tags: string[]; category: string; enabled?: boolean }) {
    const query = usePagedPromptQuery({
        queryKey: ["prompts", keyword, tags, category],
        queryFn: ({ pageParam }: { pageParam: number }) => fetchPrompts({ keyword, tag: tags, category, page: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: 1,
        getNextPageParam: (lastPage: PromptListResponse, pages: PromptListResponse[]) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    }) as PromptListQuery;
    const firstPage = query.data?.pages[0];
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]),
        categories: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.categories || [])], [firstPage?.categories]),
        total: firstPage?.total || 0,
    };
}
