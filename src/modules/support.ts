import type { HttpClient } from '../utils/http-client';
import type {
  TicketResponse,
  CreateTicketRequest,
  UpdateTicketRequest,
  AssignTicketRequest,
  ChangeStatusRequest,
  TicketStatus,
  TicketPriority,
  TicketReplyResponse,
  CreateTicketReplyRequest,
  SupportCategory,
  CreateCategoryRequest,
  KnowledgeBaseArticle,
  CreateArticleRequest,
  UpdateArticleRequest,
  RateArticleRequest,
  PaginatedResponse,
  PaginationQuery,
} from '../types';

type ArticleResponse = KnowledgeBaseArticle;

// =============================================================================
// Support Module
// =============================================================================

export class SupportModule {
  constructor(private readonly client: HttpClient) {}

  // ---------------------------------------------------------------------------
  // Tickets
  // ---------------------------------------------------------------------------

  /**
   * Create a support ticket
   *
   * @example
   * ```ts
   * const ticket = await sdk.support.createTicket({
   *   userId: 'user-uuid',
   *   subject: 'Cannot access my account',
   *   description: 'I forgot my password and cannot reset it',
   *   priority: 'high'
   * });
   * ```
   */
  async createTicket(request: CreateTicketRequest): Promise<TicketResponse> {
    return this.client.post<TicketResponse>('/support/tickets', request);
  }

  /**
   * List support tickets with optional filters
   *
   * @example
   * ```ts
   * const { data } = await sdk.support.listTickets({ page: 1 });
   *
   * // Filter by status and priority
   * const urgent = await sdk.support.listTickets({
   *   status: 'open',
   *   priority: 'urgent',
   *   page: 1
   * });
   * ```
   */
  async listTickets(
    options?: PaginationQuery & {
      status?: TicketStatus;
      priority?: TicketPriority;
      userId?: string;
      assignedToId?: string;
      categoryId?: string;
    }
  ): Promise<PaginatedResponse<TicketResponse>> {
    return this.client.get<PaginatedResponse<TicketResponse>>('/support/tickets', {
      params: options,
    });
  }

  /**
   * Get a ticket by ID
   *
   * @example
   * ```ts
   * const ticket = await sdk.support.getTicket('ticket-uuid');
   * ```
   */
  async getTicket(ticketId: string): Promise<TicketResponse> {
    return this.client.get<TicketResponse>(`/support/tickets/${ticketId}`);
  }

  /**
   * Update a ticket
   *
   * @example
   * ```ts
   * const ticket = await sdk.support.updateTicket('ticket-uuid', {
   *   priority: 'urgent',
   *   tags: ['critical', 'billing']
   * });
   * ```
   */
  async updateTicket(ticketId: string, request: UpdateTicketRequest): Promise<TicketResponse> {
    return this.client.put<TicketResponse>(`/support/tickets/${ticketId}`, request);
  }

  /**
   * Assign a ticket to a user or admin
   *
   * @example
   * ```ts
   * await sdk.support.assignTicket('ticket-uuid', {
   *   assignedToId: 'admin-uuid'
   * });
   *
   * // Unassign
   * await sdk.support.assignTicket('ticket-uuid', {});
   * ```
   */
  async assignTicket(ticketId: string, request: AssignTicketRequest): Promise<TicketResponse> {
    return this.client.put<TicketResponse>(`/support/tickets/${ticketId}/assign`, request);
  }

  /**
   * Change ticket status
   *
   * @example
   * ```ts
   * await sdk.support.changeStatus('ticket-uuid', {
   *   status: 'resolved',
   *   note: 'Issue fixed in v2.3.2'
   * });
   * ```
   */
  async changeStatus(ticketId: string, request: ChangeStatusRequest): Promise<TicketResponse> {
    return this.client.put<TicketResponse>(`/support/tickets/${ticketId}/status`, request);
  }

  // ---------------------------------------------------------------------------
  // Ticket Replies
  // ---------------------------------------------------------------------------

  /**
   * List replies on a ticket (conversation thread)
   *
   * @example
   * ```ts
   * const { data: replies } = await sdk.support.listReplies('ticket-uuid');
   * replies.forEach(reply => {
   *   console.log(`[${reply.senderType}] ${reply.senderName}: ${reply.content}`);
   * });
   * ```
   */
  async listReplies(
    ticketId: string,
    pagination?: PaginationQuery
  ): Promise<PaginatedResponse<TicketReplyResponse>> {
    return this.client.get<PaginatedResponse<TicketReplyResponse>>(
      `/support/tickets/${ticketId}/replies`,
      { params: pagination }
    );
  }

  /**
   * Add a reply to a ticket
   *
   * @example
   * ```ts
   * const reply = await sdk.support.createReply('ticket-uuid', {
   *   senderId: 'user-uuid',
   *   content: 'Here is more information about my issue...'
   * });
   * ```
   */
  async createReply(
    ticketId: string,
    request: CreateTicketReplyRequest
  ): Promise<TicketReplyResponse> {
    return this.client.post<TicketReplyResponse>(
      `/support/tickets/${ticketId}/replies`,
      request
    );
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  /**
   * List support categories
   *
   * @example
   * ```ts
   * const categories = await sdk.support.listCategories();
   * ```
   */
  async listCategories(): Promise<SupportCategory[]> {
    return this.client.get<SupportCategory[]>('/support/categories');
  }

  /**
   * Create a support category
   *
   * @example
   * ```ts
   * const category = await sdk.support.createCategory({
   *   name: 'Billing',
   *   slug: 'billing',
   *   description: 'Billing and payment issues'
   * });
   * ```
   */
  async createCategory(request: CreateCategoryRequest): Promise<SupportCategory> {
    return this.client.post<SupportCategory>('/support/categories', request);
  }

  /**
   * Update a category
   *
   * @example
   * ```ts
   * const category = await sdk.support.updateCategory('cat-uuid', {
   *   name: 'Billing & Payments'
   * });
   * ```
   */
  async updateCategory(categoryId: string, request: Partial<CreateCategoryRequest>): Promise<SupportCategory> {
    return this.client.put<SupportCategory>(`/support/categories/${categoryId}`, request);
  }

  /**
   * Delete a category
   *
   * @example
   * ```ts
   * await sdk.support.deleteCategory('cat-uuid');
   * ```
   */
  async deleteCategory(categoryId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/support/categories/${categoryId}`);
  }

  // ---------------------------------------------------------------------------
  // Knowledge Base Articles
  // ---------------------------------------------------------------------------

  /**
   * List knowledge base articles
   *
   * @example
   * ```ts
   * const { data } = await sdk.support.listArticles({ page: 1 });
   *
   * // Search articles
   * const results = await sdk.support.listArticles({
   *   search: 'password reset',
   *   publishedOnly: true
   * });
   * ```
   */
  async listArticles(
    options?: PaginationQuery & {
      categoryId?: string;
      search?: string;
      publishedOnly?: boolean;
    }
  ): Promise<PaginatedResponse<ArticleResponse>> {
    return this.client.get<PaginatedResponse<ArticleResponse>>('/support/articles', {
      params: options,
    });
  }

  /**
   * Get an article by ID
   *
   * @example
   * ```ts
   * const article = await sdk.support.getArticle('article-uuid');
   * ```
   */
  async getArticle(articleId: string, incrementView = false): Promise<ArticleResponse> {
    return this.client.get<ArticleResponse>(`/support/articles/${articleId}`, {
      params: incrementView ? { increment_view: 'true' } : undefined,
    });
  }

  /**
   * Create a knowledge base article
   *
   * @example
   * ```ts
   * const article = await sdk.support.createArticle({
   *   title: 'How to reset your password',
   *   slug: 'how-to-reset-password',
   *   content: '# Password Reset\n\n1. Click on forgot password...',
   *   contentFormat: 'markdown',
   *   isPublished: true
   * });
   * ```
   */
  async createArticle(request: CreateArticleRequest): Promise<ArticleResponse> {
    return this.client.post<ArticleResponse>('/support/articles', request);
  }

  /**
   * Update an article
   *
   * @example
   * ```ts
   * const article = await sdk.support.updateArticle('article-uuid', {
   *   content: 'Updated content...',
   *   isPublished: true
   * });
   * ```
   */
  async updateArticle(articleId: string, request: UpdateArticleRequest): Promise<ArticleResponse> {
    return this.client.put<ArticleResponse>(`/support/articles/${articleId}`, request);
  }

  /**
   * Delete an article
   *
   * @example
   * ```ts
   * await sdk.support.deleteArticle('article-uuid');
   * ```
   */
  async deleteArticle(articleId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/support/articles/${articleId}`);
  }

  /**
   * Rate an article (helpful / not helpful)
   *
   * @example
   * ```ts
   * await sdk.support.rateArticle('article-uuid', { helpful: true });
   * ```
   */
  async rateArticle(articleId: string, request: RateArticleRequest): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(
      `/support/articles/${articleId}/rate`,
      request
    );
  }
}
