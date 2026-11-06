import { notFound } from "next/navigation";
import { pageForPath } from "@/components/shell/nav";
import { RoleHome } from "@/app/app/home";

export function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  return params.then(({ slug }) => {
    const pathname = slug?.length ? `/app/${slug.join("/")}` : "/app";
    const page = pageForPath(pathname);
    return { title: page?.title ?? "REC-DMS" };
  });
}

export default async function AppPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const pathname = slug?.length ? `/app/${slug.join("/")}` : "/app";
  const page = pageForPath(pathname);
  if (!page) notFound();
  if (pathname === "/app") return <RoleHome />;

  return (
    <article>
      <h1 className="title">{page.title}</h1>
      <p className="body rec-muted">{page.lede}</p>
    </article>
  );
}
