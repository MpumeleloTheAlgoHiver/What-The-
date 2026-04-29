import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";
import Skeleton from "../components/Skeleton";

const NewsArticlePage = ({ onBack, articleId }) => {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticle = async () => {
      if (!supabase || !articleId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("News_articles")
          .select("*")
          .eq("id", articleId)
          .single();

        if (error) throw error;

        setArticle(data);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching article:", error);
        setLoading(false);
      }
    };

    fetchArticle();
  }, [articleId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-10 pt-12 md:px-8">
          <header className="mb-6 flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-6 flex-1" />
          </header>
          <Skeleton className="mb-4 h-8 w-3/4" />
          <Skeleton className="mb-6 h-4 w-1/2" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-10 pt-12 md:px-8">
          <header className="mb-6 flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          </header>
          <div className="rounded-3xl bg-white px-6 py-16 text-center shadow-md">
            <p className="text-sm font-semibold text-slate-700">Article not found</p>
          </div>
        </div>
      </div>
    );
  }

  const publishedDate = new Date(article.published_at);
  const formattedDate = publishedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = publishedDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-10 pt-12 md:px-8">
        <header className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900">Article</h1>
        </header>

        <article className="rounded-3xl bg-white p-6 shadow-md md:p-8">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <img src="/assets/mint-logo.svg" alt="Mint" className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Mint News</p>
              <p className="text-xs text-slate-500">
                {formattedDate} • {formattedTime}
              </p>
            </div>
          </div>

          {/* Title */}
          <h2 className="mb-4 text-2xl font-bold text-slate-900 md:text-3xl">
            {article.title}
          </h2>

          {/* Source and Channel */}
          {(article.source || article.channel) && (
            <div className="mb-6 flex flex-wrap gap-2">
              {article.source && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {article.source}
                </span>
              )}
              {article.channel && (
                <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                  {article.channel}
                </span>
              )}
            </div>
          )}

          {/* Body Text */}
          {article.body_text && (
            <div className="prose prose-slate max-w-none">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {article.body_text}
              </div>
            </div>
          )}

          {/* Tags/Categories */}
          {(article.industries?.length > 0 || article.markets?.length > 0) && (
            <div className="mt-8 border-t border-slate-100 pt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Related Topics
              </p>
              <div className="flex flex-wrap gap-2">
                {article.industries?.map((industry, index) => (
                  <span
                    key={`industry-${index}`}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
                  >
                    {industry}
                  </span>
                ))}
                {article.markets?.map((market, index) => (
                  <span
                    key={`market-${index}`}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
                  >
                    {market}
                  </span>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
};

export default NewsArticlePage;
