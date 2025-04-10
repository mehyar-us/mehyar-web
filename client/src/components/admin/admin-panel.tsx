import { useState } from "react";
import { X, Edit, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { blogPosts } from "@/data/blog-posts";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdminPanel = ({ isOpen, onClose }: AdminPanelProps) => {
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    siteTitle: "MehyarSoft - Custom Web Apps, CRM & Automation Solutions",
    contactEmail: "info@mehyarsoft.com",
    featuredServices: "Web Applications, CRM Systems, Automation Solutions",
  });

  const handleSettingsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings((prev) => ({ ...prev, [name]: value }));
  };

  const handleSettingsSave = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Settings saved",
      description: "Your website settings have been updated successfully.",
    });
  };

  const handleDeletePost = (id: number) => {
    toast({
      title: "Post deleted",
      description: "The blog post has been removed successfully.",
    });
  };

  const handleEditPost = (id: number) => {
    toast({
      title: "Edit mode",
      description: "You can now edit the blog post.",
    });
  };

  const handleAddPost = () => {
    toast({
      title: "New post",
      description: "Create a new blog post.",
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto">
        <div className="p-6 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Admin Dashboard
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-300 dark:hover:text-white"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
        <div className="p-6">
          <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 mb-8">
            <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-4 flex-1">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-white mb-2">
                Blog Posts
              </h3>
              <p className="text-3xl font-bold text-primary">{blogPosts.length}</p>
            </div>
            <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-4 flex-1">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-white mb-2">
                Projects
              </h3>
              <p className="text-3xl font-bold text-secondary">47</p>
            </div>
            <div className="bg-neutral-100 dark:bg-neutral-800 rounded-lg p-4 flex-1">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-white mb-2">
                Inquiries
              </h3>
              <p className="text-3xl font-bold text-accent">12</p>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
              Manage Blog Posts
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead>
                  <tr>
                    <th className="px-4 py-3 bg-neutral-50 dark:bg-neutral-800 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Title
                    </th>
                    <th className="px-4 py-3 bg-neutral-50 dark:bg-neutral-800 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-4 py-3 bg-neutral-50 dark:bg-neutral-800 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 bg-neutral-50 dark:bg-neutral-800 text-left text-xs font-medium text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-800">
                  {blogPosts.slice(0, 3).map((post) => (
                    <tr key={post.id}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-neutral-900 dark:text-white">
                          {post.title}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={`px-2 py-1 text-xs rounded-full ${post.badgeBgClass} ${post.badgeColorClass}`}
                        >
                          {post.category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-neutral-500 dark:text-neutral-400">
                        {formatDate(post.date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex space-x-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditPost(post.id)}
                            className="text-blue-500 hover:text-blue-700"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeletePost(post.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <Button
                onClick={handleAddPost}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors"
              >
                Add New Post
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
              Website Settings
            </h3>
            <form className="space-y-4" onSubmit={handleSettingsSave}>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Site Title
                </label>
                <Input
                  type="text"
                  name="siteTitle"
                  value={settings.siteTitle}
                  onChange={handleSettingsChange}
                  className="w-full px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Contact Email
                </label>
                <Input
                  type="email"
                  name="contactEmail"
                  value={settings.contactEmail}
                  onChange={handleSettingsChange}
                  className="w-full px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Featured Services (comma-separated)
                </label>
                <Input
                  type="text"
                  name="featuredServices"
                  value={settings.featuredServices}
                  onChange={handleSettingsChange}
                  className="w-full px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  className="px-4 py-2 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors"
                >
                  Save Settings
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
